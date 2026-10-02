export function Wordmark({ variant = "espresso", className = "" }: { variant?: "espresso" | "cream"; className?: string }) {
  return (
    <picture>
      <source srcSet={`/brand/wordmark-${variant}.webp`} type="image/webp" />
      <img src={`/brand/wordmark-${variant}.png`} alt="HOLLOW" className={`wordmark ${className}`} width={900} height={157} />
    </picture>
  );
}

export function TentArt({ className = "" }: { className?: string }) {
  return (
    <picture>
      <source srcSet="/brand/tent-espresso.webp" type="image/webp" />
      <img src="/brand/tent-espresso.png" alt="" aria-hidden="true" className={`tent-art ${className}`} width={1100} height={458} />
    </picture>
  );
}
