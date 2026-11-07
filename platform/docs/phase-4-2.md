# Phase 4.2 architecture

```mermaid
sequenceDiagram
  participant CV as Python CV
  participant Line as Existing LineCounter
  participant Queue as SQLite + private files
  participant API as Fastify
  participant UI as Authorized dashboard
  CV->>CV: YOLO + ByteTrack; bounded candidates
  Line-->>CV: Valid person crossing
  CV->>CV: Best full-body + optional head detector
  CV->>Queue: Atomic files and durable metadata
  Queue->>API: Bearer-authenticated dual upload
  API->>API: Validate JPEGs and deduplicate crossingId
  API-->>UI: Operator-only metadata notification
  UI->>API: X-Operator-Token + manual/credential verification
  API-->>UI: Short-lived active-track identity
```

Detection, capture, and identity are distinct states. Detection and ByteTrack run continuously; capture occurs only after line crossing; identity remains unknown until an explicit operator or revocable credential verification. YOLO datasets contain only `person`, `head`, `car`, and `motorcycle` boxes—never resident names or addresses.

Approved annotations export into versioned YOLO folders with capture-grouped train/validation splits. Training and evaluation commands live in `cv/docs/dataset-training.md`. Model approval updates a registry only and never silently overwrites the active model.
