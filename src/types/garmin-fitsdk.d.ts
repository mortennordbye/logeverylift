// @garmin/fitsdk ships plain JavaScript. Only the parts this repo uses.
declare module "@garmin/fitsdk" {
  // Encoder and Profile are used by tests to build FIT files.
  export class Encoder {
    onMesg(mesgNum: number, mesg: Record<string, unknown>): Encoder;
    close(): Uint8Array;
  }
  export const Profile: { MesgNum: Record<string, number> };
  export class Stream {
    static fromBuffer(buffer: Buffer): Stream;
  }
  export class Decoder {
    constructor(stream: Stream);
    static isFIT(stream: Stream): boolean;
    checkIntegrity(): boolean;
    read(options?: {
      convertDateTimesToDates?: boolean;
      expandComponents?: boolean;
      mergeHeartRates?: boolean;
      convertTypesToStrings?: boolean;
    }): { messages: Record<string, Record<string, unknown>[]>; errors: unknown[] };
  }
}
