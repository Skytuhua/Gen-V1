"""Bounded source metadata at the original ACP call boundary, never a transcript.

Native messages are mutable, so every cut fingerprints the actual native prefix
before declaring it reusable. Only new metadata crosses the host boundary.
"""
import hashlib
import json
import re

MAX_SOURCES = 4096
MAX_SOURCE_BYTES = 32 * 1024 * 1024
_SHA = re.compile(r"[a-f0-9]{64}\Z")
_ENCODER = json.JSONEncoder(ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def fingerprint(value, remaining=MAX_SOURCE_BYTES):
    hasher, size = hashlib.sha256(), 0
    for part in _ENCODER.iterencode(value):
        encoded = part.encode("utf-8")
        size += len(encoded)
        if size > remaining:
            raise OverflowError("Native source metadata exceeds its byte budget")
        hasher.update(encoded)
    return hasher.hexdigest(), size


class NativeContextCapture:
    def __init__(self):
        self.generation = 0
        self.previous = None

    def retire(self):
        self.previous = None

    def capture(self, messages, binding_digest, tools):
        try:
            if not isinstance(binding_digest, str) or not _SHA.fullmatch(binding_digest):
                raise ValueError("Invalid host context binding")
            if not isinstance(messages, list) or len(messages) > MAX_SOURCES:
                raise OverflowError("Native source metadata exceeds its source budget")
            schema_digest, _ = fingerprint(tools)
            measured, source_bytes = [], 0
            for message in messages:
                if not isinstance(message, dict):
                    raise ValueError("Unsupported native source shape")
                sha256, size = fingerprint(message, MAX_SOURCE_BYTES - source_bytes)
                source_bytes += size
                role = message.get("role")
                category = "SYSTEM" if role in ("system", "developer") else "USER" if role == "user" else "TOOL" if role in ("tool", "function") else "REFERENCE"
                measured.append((sha256, size, category))
            previous = self.previous
            append = previous is not None and previous["binding"] == binding_digest and previous["schema"] == schema_digest and len(previous["measured"]) <= len(measured) and measured[:len(previous["measured"])] == previous["measured"]
            reused = len(previous["measured"]) if append else 0
            if not append:
                self.generation += 1
            revision_digest, _ = fingerprint([binding_digest, schema_digest, self.generation, measured])
            sources = [{"sequence": index, "id": f"native:{self.generation}:{index}", "revision": 1,
                        "category": item[2], "utf8Bytes": item[1], "sha256": item[0]}
                       for index, item in enumerate(measured) if index >= reused]
            result = {"version": 1, "status": "AVAILABLE", "bindingDigest": binding_digest, "schemaDigest": schema_digest,
                      "generation": self.generation, "previousDigest": previous["digest"] if append else None,
                      "revisionDigest": revision_digest, "sourceCount": len(measured), "sourceBytes": source_bytes,
                      "reusedSources": reused, "inspectedSources": len(measured), "sources": sources,
                      "change": "UNCHANGED" if append and reused == len(measured) else "APPEND" if append else "RESET",
                      "newToolResults": sum(item["category"] == "TOOL" for item in sources) if append else None,
                      "newToolResultBytes": sum(item["utf8Bytes"] for item in sources if item["category"] == "TOOL") if append else None}
            self.previous = {"binding": binding_digest, "schema": schema_digest, "measured": measured, "digest": revision_digest}
            return result
        except (OverflowError, RecursionError, TypeError, ValueError) as error:
            self.retire()
            return {"version": 1, "status": "UNAVAILABLE", "reason": "SOURCE_LIMIT" if isinstance(error, (OverflowError, RecursionError)) else "UNSUPPORTED_SOURCE"}
