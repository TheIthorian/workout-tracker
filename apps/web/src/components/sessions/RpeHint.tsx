import { InfoHint } from '@/components/common/InfoHint';

/** Explains the RPE scale wherever the value is entered, since the abbreviation carries all of the meaning. */
export function RpeHint(): JSX.Element {
    return (
        // The hint shares a text-sized label row, so negative margins keep its tap target from stretching one.
        <InfoHint label="What RPE means" className="-my-1">
            <span className="font-medium text-foreground">Rate of Perceived Exertion</span> — how hard the set felt, on
            a scale of 0 to 10. 10 means nothing left in the tank, 9 leaves about one more rep, 8 about two. Optional,
            so leave it blank if you would rather not judge it.
        </InfoHint>
    );
}
