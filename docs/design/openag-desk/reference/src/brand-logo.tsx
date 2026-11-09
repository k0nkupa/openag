const brands = {
  github: true,
  gmail: false,
  calendar: false,
  slack: false,
  linear: true,
  brave: false,
  claudecode: false,
  codex: false,
  anthropic: true,
  openai: true,
  nebius: true,
  typesafe: true,
  openrouter: true,
  ollama: true,
};
export type BrandId = keyof typeof brands;

export function BrandLogo({ brand }: { brand: BrandId }) {
  return <img className="brand-logo" src={`/brands/${brand}.svg`} data-brand={brand} data-monochrome={brands[brand]} width={24} height={24} alt="" aria-hidden="true" draggable={false} />;
}
