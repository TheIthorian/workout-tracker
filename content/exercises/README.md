# Exercise catalog

Each directory is one catalog exercise; its name is the slug. `exercise.json` holds the text and
lists the images and links; images live under `images/`. The format is validated by
`packages/catalog` (see `exerciseEntrySchema`).

The starter library covers common strength, bodyweight, core, and cardio movements. Use
`weight_reps` for loaded and bodyweight strength work, `duration` for static holds, and
`distance_time` for cardio. Keep an entry focused on one movement; use `notes` to clarify equipment
or how to record a single-dumbbell or alternating movement.

`muscles` tags what the movement trains (see `MuscleGroup` in `@app/domain`): `primary` is what the
movement is for, `secondary` what it also works without being the point of it. Both feed the body
diagram on the exercise page and the muscle heatmap over workout history, where a secondary muscle
counts half a set. Leave a list empty rather than guessing.

`equipment` lists everything the movement requires (see `Equipment` in `@app/domain`); leave it
empty for bodyweight and outdoor work. `machine` covers pin- and plate-loaded machines; `cable` is a
cable stack.

Publish with `pnpm --filter @app/admin start seed-exercises` against the target database and
bucket (`DATABASE_URL`, `S3_*`). Runs are idempotent; removing a directory archives its exercise
rather than deleting it, because past sessions reference it.
