declare module "jpeg-js" {
  export interface DecodeOptions {
    useTArray?: boolean;
    maxResolutionInMP?: number;
    maxMemoryUsageInMB?: number;
  }

  export interface DecodedJpeg {
    width: number;
    height: number;
    data: Uint8Array | Buffer | number[];
  }

  export function decode(buffer: Buffer | Uint8Array, options?: DecodeOptions): DecodedJpeg;
}
