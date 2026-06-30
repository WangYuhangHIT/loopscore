'use strict';
/**
 * tailer.js — watch a directory of append-only *.jsonl files and emit each line.
 *
 * Polling (not fs.watch) for deterministic, cross-platform behaviour. Reads each
 * file incrementally by byte offset; buffers partial (newline-less) trailing data;
 * re-reads from 0 on truncation/rotation. Never throws on a missing dir or file.
 *
 *   createTailer(dir, onLine, { pollMs }) -> { pollOnce, close }
 *     onLine(line, filePath) is called once per complete line.
 */

const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

function createTailer(dir, onLine, opts = {}) {
  const pollMs = opts.pollMs != null ? opts.pollMs : 1000;
  const offsets = new Map(); // filePath -> byte offset already consumed
  const buffers = new Map(); // filePath -> partial trailing line (decoded)
  const decoders = new Map(); // filePath -> StringDecoder (holds incomplete multibyte BYTES across reads)

  function readFileIncrement(file) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return; // file vanished between listing and open
    }
    try {
      const size = fs.fstatSync(fd).size;
      let offset = offsets.get(file) || 0;
      if (size < offset) {
        // truncated/rotated — start over (drop any half-decoded bytes too)
        offset = 0;
        buffers.set(file, '');
        decoders.set(file, new StringDecoder('utf8'));
      }
      const len = size - offset;
      if (len > 0) {
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, offset);
        offsets.set(file, size);
        // Decode through a per-file StringDecoder: a multi-byte char split across this
        // read's tail is held as bytes and completed on the next read, instead of being
        // mangled into U+FFFD by a naive buf.toString('utf8').
        let dec = decoders.get(file);
        if (!dec) { dec = new StringDecoder('utf8'); decoders.set(file, dec); }
        let data = (buffers.get(file) || '') + dec.write(buf);
        const parts = data.split('\n');
        const partial = parts.pop(); // last element is incomplete (no trailing \n)
        buffers.set(file, partial);
        for (const line of parts) {
          if (line.trim()) {
            try { onLine(line, file); } catch { /* consumer error must not kill the tailer */ }
          }
        }
      } else {
        offsets.set(file, size);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  const SKIP_DIRS = new Set(['memory', 'node_modules', '.git']);

  // Collect every *.jsonl under `root`, recursing into subdirs. Sub-agent and
  // workflow-agent transcripts live in <sessionId>/subagents/**, so a flat listing
  // would miss all of them. memory/ holds the assistant's own notes — never tail it.
  function collect(root, out) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return; // dir missing/unreadable — silent, will retry next poll
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        collect(path.join(root, ent.name), out);
      } else if (ent.name.endsWith('.jsonl')) {
        out.push(path.join(root, ent.name));
      }
    }
  }

  function pollOnce() {
    const files = [];
    collect(dir, files);
    for (const file of files) {
      // stat-gate: skip the open/read entirely when a file hasn't grown. With
      // hundreds of completed sub-agent transcripts this keeps each poll cheap.
      let size;
      try { size = fs.statSync(file).size; } catch { continue; }
      const offset = offsets.get(file) || 0;
      if (size === offset) continue;
      readFileIncrement(file);
    }
  }

  let timer = null;
  if (pollMs > 0) {
    timer = setInterval(pollOnce, pollMs);
    if (timer.unref) timer.unref();
  }

  return {
    pollOnce,
    close() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { createTailer };
