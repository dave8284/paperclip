/** Only user-facing answer text enters speech; unfinished Markdown constructs
 * stay buffered until their meaning is known. */
export function spokenReply(text: string, complete = true) {
  if (!complete) {
    const fences = [...text.matchAll(/```/g)];
    if (fences.length % 2) text = text.slice(0, fences.at(-1)!.index);
    text = text.replace(/!?\[[^\]]*$/, "").replace(/!?\[[^\]]*\]\([^)]*$/, "");
  }
  return text.replace(/```[\s\S]*?```/g, " Code is available in the conversation. ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " linked source ").replace(/[#*_`>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 6000);
}

function chunkEnd(text: string, limit: number, complete: boolean) {
  const prefix = text.slice(0, limit);
  const sentence = /[.!?](?:\s|$)/.exec(text);
  if (sentence && sentence.index < limit && (complete || sentence.index < text.length - 1 || !/\d/.test(text[sentence.index - 1] ?? ""))) return sentence.index + 1;
  if (text.length <= limit) return complete ? text.length : 0;
  // Do not speak half a number/word from a still-growing provider delta.
  const word = prefix.lastIndexOf(" ");
  return word > 0 ? word : complete ? limit : 0;
}

export function spokenReplyChunks(text: string) {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining) {
    const end = chunkEnd(remaining, chunks.length ? 220 : 120, true);
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  return chunks;
}

/** An append-only answer buffer. A new provider delta wakes its consumer; no
 * polling, model calls or background synthesis occur while it has no sentence. */
export class FridaySpeechBuffer {
  private queue: string[] = [];
  private waiter?: (chunk: string | null) => void;
  private ended = false;
  private prefix = "";
  private count = 0;
  text = "";
  cancelled = false;

  update(body: string, complete: boolean) {
    if (this.cancelled || this.ended) return;
    const text = spokenReply(body, complete);
    // A provider correction cannot rewrite words already queued/spoken. Stop
    // the old audio; the corrected answer remains visible in the conversation.
    if (this.prefix && !text.startsWith(this.prefix)) { this.cancel(); return; }
    this.text = text;
    let remaining = text.slice(this.prefix.length).trimStart();
    while (remaining) {
      const end = chunkEnd(remaining, this.count ? 220 : 120, complete);
      if (!end) break;
      const chunk = remaining.slice(0, end).trim();
      this.prefix += (this.prefix ? " " : "") + chunk;
      this.count++;
      this.queue.push(chunk);
      remaining = remaining.slice(end).trimStart();
    }
    this.ended = complete;
    this.flush();
  }

  next(): string | null | Promise<string | null> {
    if (this.queue.length) return this.queue.shift()!;
    if (this.ended) return null;
    return new Promise(resolve => { this.waiter = resolve; });
  }

  cancel() { this.cancelled = true; this.ended = true; this.queue = []; this.flush(); }
  private flush() {
    if (!this.waiter || (!this.queue.length && !this.ended)) return;
    const resolve = this.waiter; this.waiter = undefined;
    resolve(this.queue.shift() ?? null);
  }
}
