/**
 * The closed set of equipment an exercise can require. An exercise lists everything it needs; an
 * empty list is a bodyweight movement.
 */
export enum Equipment {
    Barbell = 'barbell',
    Dumbbell = 'dumbbell',
    Kettlebell = 'kettlebell',
    Cable = 'cable',
    Machine = 'machine',
    SquatRack = 'squat_rack',
    Bench = 'bench',
    PullUpBar = 'pull_up_bar',
    ResistanceBand = 'resistance_band',
    Treadmill = 'treadmill',
    StationaryBike = 'stationary_bike',
    RowingMachine = 'rowing_machine',
}

/**
 * Where a workspace is in first-run setup, ordered. The web app sends the user to the screen for
 * the current stage; a new stage can be inserted and existing workspaces moved to it by migration.
 */
export enum OnboardingStage {
    Equipment = 'equipment',
    Complete = 'complete',
}
