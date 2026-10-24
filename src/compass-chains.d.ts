declare module '@circlefin/compass-chains' {
  export interface CompassChainDef {
    name: string;
    explorerUrl?: string;
    nativeCurrency: {
      symbol: string;
      decimals?: number;
    };
  }

  export function getChain(compassChain: string): CompassChainDef;
}
