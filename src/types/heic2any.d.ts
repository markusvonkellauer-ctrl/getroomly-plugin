// heic2any ships its own dist/heic2any.d.ts, but that file `import`s two
// sibling modules ("./gifshot", "./libheif") that don't exist anywhere in
// the published package — only heic2any.js/.min.js are shipped. Resolving
// that file fails module resolution, so this ambient declaration shims the
// module directly and takes precedence over the package's own (broken)
// types for this exact specifier.
declare module 'heic2any' {
  interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
    multiple?: true;
    gifInterval?: number;
  }

  export default function heic2any(options: Heic2AnyOptions): Promise<Blob | Blob[]>;
}
