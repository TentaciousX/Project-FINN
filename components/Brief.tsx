"use client";
import { useCallback, useEffect, useRef, useState } from "react";

const RATES = [1, 1.25, 1.5];

// The morning brief as audio: one sentence at a time, so it can pause, skip and
// show the line being read. Uses the phone's own speech engine; no model call.
export default function Brief({ lines }: { lines: string[] }) {
  const [idx, setIdx] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState(1);
  const token = useRef(0);
  // Decided after load so the server-rendered page and the browser agree.
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported("speechSynthesis" in window), []);

  const say = useCallback(
    (i: number, r: number) => {
      if (!supported) return;
      const my = ++token.current;
      window.speechSynthesis.cancel();
      if (i < 0 || i >= lines.length) {
        setIdx(-1);
        return;
      }
      setIdx(i);
      setPaused(false);
      const u = new SpeechSynthesisUtterance(lines[i]);
      u.rate = r;
      u.onend = () => {
        if (token.current === my) say(i + 1, r);
      };
      window.speechSynthesis.speak(u);
    },
    [lines, supported]
  );

  useEffect(() => () => {
    token.current++;
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  if (!supported) return null;
  if (idx < 0)
    return (
      <button className="link" onClick={() => say(0, rate)}>
        Play the 60-second brief
      </button>
    );
  return (
    <>
      <button className="link" onClick={() => say(-1, rate)}>Stop the brief</button>
      <div className="player" role="region" aria-label="Audio brief">
        <p aria-live="polite">{lines[idx]}</p>
        <div>
          <button
            onClick={() => {
              if (paused) window.speechSynthesis.resume();
              else window.speechSynthesis.pause();
              setPaused(!paused);
            }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button onClick={() => say(idx - 1 < 0 ? 0 : idx - 1, rate)}>Back</button>
          <button onClick={() => say(idx + 1, rate)}>Next</button>
          <button
            onClick={() => {
              const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
              setRate(r);
              say(idx, r);
            }}
          >
            {rate}× speed
          </button>
          <span>{idx + 1} of {lines.length}</span>
        </div>
      </div>
    </>
  );
}
