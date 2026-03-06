import * as readline from "node:readline";
import type { Interviewer, Question, Answer } from "./types.js";

// ─── AutoApproveInterviewer ─────────────────────────────────────────────────

export class AutoApproveInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    if (question.type === "yes_no") {
      return { value: "yes" };
    }
    if (
      question.type === "multiple_choice" &&
      question.options?.length
    ) {
      return {
        value: question.options[0].key,
        selected_option: question.options[0],
      };
    }
    if (question.default) {
      return question.default;
    }
    return { value: "yes" };
  }
}

// ─── ConsoleInterviewer ─────────────────────────────────────────────────────

export class ConsoleInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      let prompt = question.text;

      if (question.options?.length) {
        prompt +=
          "\n" +
          question.options
            .map((o) => `  [${o.key}] ${o.label}`)
            .join("\n") +
          "\n> ";
      } else if (question.type === "yes_no") {
        prompt += " [Y/n] ";
      } else {
        prompt += "\n> ";
      }

      const answer = await new Promise<string>((resolve) => {
        rl.question(prompt, resolve);
      });

      if (question.type === "yes_no") {
        const val = answer.trim().toLowerCase();
        return {
          value: val === "" || val === "y" || val === "yes" ? "yes" : "no",
        };
      }

      if (question.options?.length) {
        const normalized = answer.trim().toUpperCase();
        const match = question.options.find(
          (o) =>
            o.key.toUpperCase() === normalized ||
            o.label.toLowerCase() === answer.trim().toLowerCase()
        );
        if (match) {
          return { value: match.key, selected_option: match };
        }
      }

      return { value: answer.trim(), text: answer.trim() };
    } finally {
      rl.close();
    }
  }

  inform(message: string, stage?: string): void {
    const prefix = stage ? `[${stage}] ` : "";
    console.log(`${prefix}${message}`);
  }
}

// ─── QueueInterviewer (for testing) ─────────────────────────────────────────

export class QueueInterviewer implements Interviewer {
  private answers: Answer[];

  constructor(answers: Answer[]) {
    this.answers = [...answers];
  }

  async ask(_question: Question): Promise<Answer> {
    const answer = this.answers.shift();
    if (!answer) {
      return { value: "skipped" };
    }
    return answer;
  }
}

// ─── CallbackInterviewer ────────────────────────────────────────────────────

export class CallbackInterviewer implements Interviewer {
  constructor(
    private callback: (question: Question) => Promise<Answer>
  ) {}

  async ask(question: Question): Promise<Answer> {
    return this.callback(question);
  }
}

// ─── RecordingInterviewer ───────────────────────────────────────────────────

export class RecordingInterviewer implements Interviewer {
  readonly recordings: Array<{ question: Question; answer: Answer }> = [];

  constructor(private delegate: Interviewer) {}

  async ask(question: Question): Promise<Answer> {
    const answer = await this.delegate.ask(question);
    this.recordings.push({ question, answer });
    return answer;
  }

  inform(message: string, stage?: string): void {
    this.delegate.inform?.(message, stage);
  }
}
