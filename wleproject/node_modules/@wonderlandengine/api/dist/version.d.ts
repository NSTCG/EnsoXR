/**
 * Version type following a subset of the Semantic Versioning specification.
 */
export type Version = {
    major: number;
    minor: number;
    patch: number;
    rc: number;
};
/** Version of this API. */
export declare const APIVersion: Version;
