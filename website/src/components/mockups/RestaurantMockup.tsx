/**
 * Restaurant POS mockup — the current hero's coffee-shop POS screen.
 * Pure presentational markup (Tailwind), no state. The carousel frame
 * provides the window chrome; this component is the app content only.
 */
export default function RestaurantMockup() {
  return (
    <div className="grid h-full grid-cols-12 gap-4 p-6">
      {/* Sidebar */}
      <div className="col-span-2 space-y-3">
        <div className="rounded-lg border border-ink/5 bg-surface/80 p-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-bold text-accent">D</div>
            <div>
              <p className="text-xs font-semibold">Dewi</p>
              <p className="text-[10px] text-muted">Kasir</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md bg-accent/10 px-2 py-1.5 text-[10px] font-medium text-accent">Penjualan</div>
            <div className="rounded-md px-2 py-1.5 text-[10px] text-muted hover:bg-ink/5">Menu</div>
            <div className="rounded-md px-2 py-1.5 text-[10px] text-muted hover:bg-ink/5">Pesanan</div>
            <div className="rounded-md px-2 py-1.5 text-[10px] text-muted hover:bg-ink/5">Laporan</div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="col-span-7 space-y-4">
        {/* Category Tabs */}
        <div className="flex gap-2">
          <span className="rounded-full bg-primary px-4 py-2 text-xs font-medium text-on-primary">Semua</span>
          <span className="rounded-full border border-ink/10 bg-surface/80 px-4 py-2 text-xs text-muted">Kopi</span>
          <span className="rounded-full border border-ink/10 bg-surface/80 px-4 py-2 text-xs text-muted">Makanan</span>
          <span className="rounded-full border border-ink/10 bg-surface/80 px-4 py-2 text-xs text-muted">Minuman</span>
          <span className="rounded-full border border-ink/10 bg-surface/80 px-4 py-2 text-xs text-muted">Camilan</span>
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-4 gap-3">
          {[
            ['Kopi Tubruk', '18.000', '☕'],
            ['Kopi Susu', '22.000', '🥛'],
            ['Nasi Goreng', '25.000', '🍚'],
            ['Mie Goreng', '23.000', '🍜'],
            ['Es Teh Manis', '8.000', '🧊'],
            ['Es Jeruk', '12.000', '🍊'],
            ['Roti Bakar', '15.000', '🍞'],
            ['Pisang Goreng', '10.000', '🍌'],
          ].map(([name, price, emoji]) => (
            <div
              key={name}
              className="mockup-card cursor-pointer rounded-xl border border-ink/5 bg-surface/90 p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md"
            >
              <div className="mb-2 text-2xl transition-transform duration-200">{emoji}</div>
              <p className="text-xs font-semibold text-ink/90">{name}</p>
              <p className="mt-1 text-[11px] font-medium text-accent">Rp {price}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Cart Panel */}
      <div className="col-span-3">
        <div className="flex h-full flex-col rounded-xl border border-ink/5 bg-surface/90 p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold">Pesanan Baru</p>
            <span className="bg-ink/5 px-2 py-1 text-[10px] text-muted">#1042</span>
          </div>

          <div className="mb-4 flex-1 space-y-3">
            {[
              ['Kopi Tubruk', '×2', '36.000'],
              ['Nasi Goreng', '×1', '25.000'],
              ['Es Teh Manis', '×1', '8.000'],
            ].map(([item, qty, price]) => (
              <div key={item} className="flex items-start justify-between text-xs">
                <div>
                  <p className="font-medium">{item}</p>
                  <p className="text-[10px] text-muted">{qty}</p>
                </div>
                <span className="text-muted">Rp {price}</span>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-ink/10 pt-3">
            <div className="flex justify-between text-sm font-bold">
              <span>Total</span>
              <span className="text-accent">Rp 69.000</span>
            </div>
            <div className="mockup-btn cursor-pointer rounded-lg bg-gradient-to-r from-primary to-primary-hover py-3 text-center text-sm font-bold text-on-primary shadow-md transition-all duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)] hover:scale-[1.03] hover:shadow-lg active:scale-[0.97]">
              Bayar · QRIS
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
