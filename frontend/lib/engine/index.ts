// Engine barrel — the parity-gated matching engine (equals the v10 oracle).
export * from './types';
export {
  solveAffine, applyAffine, fitSimilarity, linAnisotropy, distSeg,
  icpRefine, deriveSeed,
} from './geometry';
export { hungarian, runColumnMatch, PIER_TOL } from './match';
export { autoName } from './naming';
export type { NamedCol, NamingResult, OrphanName } from './naming';
