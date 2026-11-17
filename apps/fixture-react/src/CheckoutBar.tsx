type Props = {
  quantity: number;
  onReset: () => void;
};

export function CheckoutBar({ quantity, onReset }: Props) {
  return (
    <footer className="checkout" data-testid="checkout-bar">
      <span>
        Cart items: <strong>{quantity}</strong>
      </span>
      <button type="button" onClick={onReset}>
        Reset
      </button>
    </footer>
  );
}
