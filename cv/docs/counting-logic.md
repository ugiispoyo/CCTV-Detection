# Counting logic

## Identity scope

ByteTrack assigns a `trackId` while processing consecutive frames. It is not a person or vehicle identity and is unique only within the generated `sessionId`. A reconnect discards the Ultralytics predictor/tracker state, generates a new session UUID, and clears line-side state.

## Crossing

For each tracked bounding box, the configured anchor is projected against the oriented line using the signed perpendicular distance:

```text
distance = cross(line_vector, anchor - line_start) / line_length
```

A distance greater than the pixel margin is the positive side; less than the negative margin is the negative side; inside the band is neutral. A crossing requires a previously observed stable side and then the opposite stable side. Traveling through the full band provides meaningful movement and prevents an object that merely appears or jitters near the line from counting.

`negative_to_positive` or `positive_to_negative` is mapped to IN; the other transition is OUT. Line endpoint order defines the sign, so verify perspective with real footage.

Each track can count once per line and session. Short tracking losses preserve side state for 30 seconds. Reconnects reset tracking-specific state safely. Generated UUID event IDs are stored in SQLite before delivery and remain unchanged across HTTP retries; Fastify provides a second database-enforced idempotency boundary.

## Anchor and units

`bottom_center` approximates a ground contact point for people and vehicles. `COUNTING_MARGIN` is in pixels of the original captured frame—not the YOLO inference tensor—because Ultralytics returns coordinates scaled to the source frame.

## Limitations

- A rider and motorcycle are separate COCO classes and are counted independently.
- Phase 2 does not associate riders with motorcycles or distinguish riders from pedestrians.
- Occlusion, ID switches, poor camera angles, and detections below the threshold can affect counts.
- One track is allowed one crossing per session, favoring duplicate prevention over counting repeated back-and-forth movement.
