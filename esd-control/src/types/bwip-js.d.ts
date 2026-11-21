// bwip-js solo publica tipos bajo la condición "node", que la resolución "bundler" de
// TypeScript no usa. Declaramos la parte de la API que utiliza el servidor.
declare module "bwip-js" {
  const bwipjs: {
    toBuffer(opts: Record<string, unknown>): Promise<Buffer>;
    toSVG(opts: Record<string, unknown>): string;
  };
  export default bwipjs;
}
