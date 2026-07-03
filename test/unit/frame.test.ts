/**
 * IPC frame reader tests (Chapter 3.2 / 7.2).
 */
import { describe, expect, it } from "vite-plus/test";
import { encodeFrame, FrameReader, isIpcFrame, isIpcRequest } from "../../src/shared/frame.js";

describe("IPC frame protocol boundary", () => {
  it("Scenario: Given partial socket chunks, When a complete request arrives, Then it is promoted only by the request guard", () => {
    const reader = new FrameReader();
    reader.push('{"command":"pub');
    expect([...reader.drain()]).toEqual([]);

    reader.push('lish","cwd":"/tmp/pkg","args":["--access","public"]}\n');
    const frames = [...reader.drain()];

    expect(frames).toHaveLength(1);
    expect(isIpcRequest(frames[0])).toBe(true);
    expect(isIpcFrame(frames[0])).toBe(false);
  });

  it("Scenario: Given daemon response bytes, When the frame is complete, Then it is promoted only by the response guard", () => {
    const reader = new FrameReader();
    reader.push(encodeFrame({ type: "exit", code: 0, message: "done" }));
    const frames = [...reader.drain()];

    expect(frames).toHaveLength(1);
    expect(isIpcFrame(frames[0])).toBe(true);
    expect(isIpcRequest(frames[0])).toBe(false);
  });

  it("Scenario: Given malformed or invalid JSON frames, When drained, Then no protocol guard treats them as ontology", () => {
    const reader = new FrameReader();
    reader.push('{bad json}\n{"type":"exit","code":"0"}\nnull\n');
    const frames = [...reader.drain()];

    expect(frames).toHaveLength(3);
    expect(frames.some(isIpcRequest)).toBe(false);
    expect(frames.some(isIpcFrame)).toBe(false);
  });
});
