# Entity Setup — PT Perorangan

> Registration path for the business entity, online and self-service.
> Scope: `[UNVERIFIED]` throughout — see [`README.md`](./README.md#status-of-these-documents).

## Step 1 — Lock the legal entity at Kemenkumham (Rp50.000)

1. Open the official AHU Perseroan Perorangan service at <https://ahu.go.id>
2. Register with KTP, personal NPWP, and an active email address.
3. Buy the PNBP registration voucher (Rp50.000) via the payment menu; instant
   Virtual Account payment through m-banking works.
4. Check the PT name. At least 3 Indonesian-language words
   (example: *PT Solusi Kasir Pintar*).
5. In **Modal Dasar** and **Modal Disetor**, enter: **Rp3.100.000.000,-**
6. Enter the five KBLI codes listed in [`kbli-codes.md`](./kbli-codes.md) — they cover
   software work, SaaS licensing, cloud hosting, and both wholesale and retail trade in
   cashier hardware.
7. Confirm, then download and print the **Sertifikat Pendirian PT Perorangan**.

Cost: Rp50.000 `[UNVERIFIED]`

## Step 2 — Activate the business licence and corporate NPWP at OSS (free)

1. Open the OSS service at <https://oss.go.id>
2. Choose **Urus Perizinan Berusaha UMK** → **Perseroan Perorangan**.
3. Enter the PT registration number from the AHU certificate. Company data and the
   Rp3.1 M capital figure sync automatically.
4. OSS issues the corporate NPWP automatically through the Ditjen Pajak integration.
5. Complete the business location and activity description for each KBLI. Working
   narrative:

   > Menyediakan platform Point of Sales (POS) berbasis cloud untuk manajemen kasir,
   > inventori, dan pelaporan usaha yang terintegrasi dengan penyedia sistem pembayaran
   > pihak ketiga, serta melakukan distribusi/perdagangan perangkat kasir pendukung.

6. OSS issues the **Nomor Induk Berusaha (NIB)**.

### Open question: does the NIB also function as API-U?

The source document asserts the NIB is automatically a valid **Angka Pengenal Importir
Umum (API-U)** for customs. `[UNVERIFIED]` — this is the claim most worth confirming
independently, because the EDC hardware import path in
[`kbli-codes.md`](./kbli-codes.md) depends on it. Confirm with OSS/Ditjen Bea dan Cukai
before relying on it.

## Open question: non-cash capital and the deed

The source document routes Rp3,1 M of **non-cash** (inbreng) capital through the same
online self-service flow as cash. `[UNVERIFIED]` — capital paid in as assets rather
than money generally attracts additional formality (deed, valuation, and possibly a
different submission path) that this procedure does not mention. Resolve together with
[`inbreng-valuation.md`](./inbreng-valuation.md) before filing.
