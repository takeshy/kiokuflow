/** SSE parsing preserves split UTF-8, CRLF and frames split at arbitrary byte boundaries. */
export async function* readSseJson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const parse = () => {
    const payload = data.join("\n");
    data = [];
    return payload && payload !== "[DONE]" ? JSON.parse(payload) as T : null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (!line) {
          const event = parse();
          if (event) yield event;
        } else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (done) {
        if (buffer.startsWith("data:")) data.push(buffer.slice(5).trimStart());
        const event = parse();
        if (event) yield event;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

