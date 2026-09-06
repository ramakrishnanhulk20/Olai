import type Anthropic from '@anthropic-ai/sdk';

/**
 * A scripted stand-in for the Anthropic client.
 *
 * It runs the real tool objects the analyst builds, in the order the script
 * says, so an attack exercises Olai's own tool code without a network call, an
 * API key or a token bill. What it does not do is check that the arguments the
 * analyst passes to toolRunner are ones the real API accepts; only a live call
 * proves that.
 *
 * This is a copy of test/brain/fake-anthropic.ts on purpose. The attack scripts
 * are meant to run against the shipped agent without the test tree present, so
 * they do not reach into it.
 */

export interface ScriptedCall {
  name: string;
  input: unknown;
}

export interface ScriptedTurn {
  thinking?: string;
  text?: string;
  toolCalls?: ScriptedCall[];
  stopReason?: 'end_turn' | 'tool_use' | 'refusal' | 'pause_turn' | 'max_tokens';
}

interface RunnableToolLike {
  name: string;
  parse: (raw: unknown) => unknown;
  run: (input: unknown, context?: unknown) => Promise<unknown>;
}

interface RunnerParams {
  model: string;
  tools: RunnableToolLike[];
  messages: Array<Record<string, unknown>>;
  max_iterations?: number;
  [key: string]: unknown;
}

type Listener = (...args: unknown[]) => void;

class FakeStream {
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    private readonly turn: ScriptedTurn,
    private readonly message: Record<string, unknown>,
  ) {}

  on(event: string, listener: Listener): this {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
    return this;
  }

  // The real stream emits while the caller is awaiting the final message, so
  // the fake waits until then too. Emitting in the constructor would fire
  // before the analyst has attached its listeners.
  async finalMessage(): Promise<Record<string, unknown>> {
    if (this.turn.thinking !== undefined) {
      this.emit('thinking', this.turn.thinking, this.turn.thinking);
    }
    if (this.turn.text !== undefined) {
      this.emit('text', this.turn.text, this.turn.text);
    }
    return this.message;
  }

  abort(): void {}

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

class FakeToolRunner {
  private readonly messages: Array<Record<string, unknown>>;
  private final: Record<string, unknown> | undefined;
  private callSeq = 0;

  constructor(
    private readonly runnerParams: RunnerParams,
    private readonly script: ScriptedTurn[],
  ) {
    this.messages = structuredClone(runnerParams.messages);
  }

  get params(): RunnerParams {
    return { ...this.runnerParams, messages: this.messages };
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<FakeStream> {
    const limit = this.runnerParams.max_iterations ?? this.script.length;

    for (const turn of this.script.slice(0, limit)) {
      const toolCalls = turn.toolCalls ?? [];
      const blocks = toolCalls.map((call) => {
        this.callSeq += 1;
        return {
          type: 'tool_use' as const,
          id: `toolu_${this.callSeq}`,
          name: call.name,
          input: call.input,
        };
      });

      const content: Array<Record<string, unknown>> = [
        ...(turn.text === undefined ? [] : [{ type: 'text', text: turn.text }]),
        ...blocks,
      ];

      const message: Record<string, unknown> = {
        id: `msg_${this.callSeq}`,
        type: 'message',
        role: 'assistant',
        model: this.runnerParams.model,
        content,
        stop_reason: turn.stopReason ?? (blocks.length > 0 ? 'tool_use' : 'end_turn'),
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      };

      this.final = message;
      yield new FakeStream(turn, message);

      this.messages.push({ role: 'assistant', content });

      if (message.stop_reason === 'refusal') {
        return;
      }
      if (blocks.length === 0) {
        return;
      }

      const results: Array<Record<string, unknown>> = [];
      for (const block of blocks) {
        const tool = this.runnerParams.tools.find((candidate) => candidate.name === block.name);
        if (!tool) {
          throw new Error(`the script called a tool that does not exist: ${block.name}`);
        }
        const parsed = tool.parse(block.input);
        const output = await tool.run(parsed, { toolUse: block, toolUseBlock: block });
        results.push({ type: 'tool_result', tool_use_id: block.id, content: output });
      }

      this.messages.push({ role: 'user', content: results });
    }
  }

  async done(): Promise<Record<string, unknown>> {
    if (!this.final) {
      throw new Error('the fake runner produced no message');
    }
    return this.final;
  }
}

export interface FakeAnthropic {
  client: Anthropic;
  /** The params handed to each toolRunner call, in order. */
  calls: RunnerParams[];
}

/** Builds a fake client. Each entry in runs scripts one toolRunner call. */
export function fakeAnthropic(runs: ScriptedTurn[][]): FakeAnthropic {
  const calls: RunnerParams[] = [];
  let index = 0;

  const client = {
    beta: {
      messages: {
        toolRunner(params: RunnerParams) {
          calls.push(params);
          const script = runs[index] ?? [];
          index += 1;
          return new FakeToolRunner(params, script);
        },
      },
    },
  };

  return { client: client as unknown as Anthropic, calls };
}
