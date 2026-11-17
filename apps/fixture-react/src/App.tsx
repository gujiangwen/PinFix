import { useState } from "react";
import { ProductCard } from "./ProductCard";
import { CheckoutBar } from "./CheckoutBar";

export function App() {
  const [qty, setQty] = useState(1);

  return (
    <div className="page">
      <header className="hero">
        <p className="brand">SightLoop Fixture</p>
        <h1>React pick demo</h1>
        <p className="lede">
          Load the unpacked SightLoop extension, press Alt+Shift+A, and pick a
          component below to see the Fiber stack.
        </p>
      </header>

      <main className="shelf">
        <ProductCard
          title="Aurora Lamp"
          price={48}
          secretToken="should-be-redacted"
          onAdd={() => setQty((q) => q + 1)}
        />
        <ProductCard
          title="Cedar Desk"
          price={220}
          secretToken="also-secret"
          onAdd={() => setQty((q) => q + 1)}
        />
      </main>

      <CheckoutBar quantity={qty} onReset={() => setQty(1)} />
    </div>
  );
}
