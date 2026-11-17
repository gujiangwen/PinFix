type Props = {
  title: string;
  price: number;
  /** Intentionally sensitive — sniff should redact. */
  secretToken: string;
  onAdd: () => void;
};

export function ProductCard({ title, price, onAdd }: Props) {
  return (
    <article className="card" data-testid={`product-${title}`}>
      <h2>{title}</h2>
      <p className="price">${price.toFixed(2)}</p>
      <button type="button" data-testid="add-btn" onClick={onAdd}>
        Add to cart
      </button>
    </article>
  );
}
