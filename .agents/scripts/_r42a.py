"""T21 round 42 phase 1: the products pair gets (b1), not (b2) -- and the reason is a distinction
I had been getting wrong.

Rounds 40/41 justified (b2) partly with "the screen cannot mount before a session exists". That is
true of `session`, which AppShell.tsx:119 takes from useAuth(). `sessionToken` is a DIFFERENT
context, read one line later at :120 from useWorkspace(). A staff member can be signed in with no
workspace chosen or with a workspace session that expired, so a mounted screen really can hold a
null token. The scanner arms still deserved deletion -- but because their commands are registered
nowhere, not because the branch was unreachable.

This site is different in a second way: the unscoped names have no command body at all on desktop
and no registration on tablet, and `utils/catalog-cache.ts:38-42` already records the resulting
production bug for this exact pair -- the whole catalog cache rejected on desktop. So the arm goes,
and the no-token case reports the error the doomed call used to produce by accident. Same observable
outcome, no IPC round trip that cannot succeed.
"""
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

fails = 0


def sub(rel, old, new, want=1):
    global fails
    p = pathlib.Path(rel)
    t = p.read_text(encoding="utf-8")
    n = t.count(old)
    if n != want:
        print(f"FAIL {rel}: matched {n}, expected {want}: {old[:64]!r}")
        fails += 1
        return
    p.write_text(t.replace(old, new), encoding="utf-8", newline="\n")
    print(f"ok   {rel.split('/')[-1][:34]:34} {old.splitlines()[0][:52]!r}")


U = "ui/src/features/products/useProducts.ts"
A = "ui/src/api/products.ts"

# ── 1. the hook: one arm, and an explicit unavailable path ────────────────────────────────
sub(U, """import { listProducts, listCategories, listProductsScoped, listCategoriesScoped, type ProductDto, type CategoryDto } from '@/api/products';""",
    """import { listProductsScoped, listCategoriesScoped, type ProductDto, type CategoryDto } from '@/api/products';""")

sub(U, """    (async () => {
      try {
        const fetchProducts = sessionToken ? () => listProductsScoped(sessionToken) : listProducts;
        const fetchCategories = sessionToken ? () => listCategoriesScoped(sessionToken) : listCategories;
        const [dtos, cats] = await Promise.all([fetchProducts(), fetchCategories()]);""",
    """    // Shared by both unavailable paths below: a catalog that could not be read is sample data in
    // a demo build and an empty catalog in a real one, which is what the `catch` already did.
    const applyUnavailableCatalog = () => {
      if (isDemoMode()) {
        setProducts(SAMPLE_PRODUCTS);
        setCategoryMeta(SAMPLE_CATEGORY_META);
        setUsingFallback(true);
      } else {
        setProducts([]);
        setUsingFallback(false);
      }
    };

    (async () => {
      try {
        // T21 (b1): there is no unscoped door to fall back to. `list_products` and
        // `list_categories` are registered in NEITHER shell -- the tablet carries unregistered
        // bodies (commands/products.rs, commands/categories.rs) and the desktop has no bodies at
        // all, which is the production bug `utils/catalog-cache.ts` already records for this exact
        // pair: "because desktop-client registers no list_categories command the whole cache
        // rejected on desktop". A mounted screen CAN have a null token here -- `session` comes
        // from useAuth (AppShell.tsx:119) while `sessionToken` comes from useWorkspace (:120), two
        // different contexts -- so the honest treatment is a message, not a silent skip. Calling
        // the unregistered names produced a rejection that the `catch` below turned into this same
        // error plus this same catalog; now it happens without a doomed IPC round trip.
        if (!sessionToken) {
          setError(l10nRef.current.getString('product-lookup-error-load'));
          applyUnavailableCatalog();
          return;
        }
        const [dtos, cats] = await Promise.all([
          listProductsScoped(sessionToken),
          listCategoriesScoped(sessionToken),
        ]);""")

sub(U, """        setError(l10nErrorMessage(err, l10nRef.current, 'product-lookup-error-load'));
        if (isDemoMode()) {
          setProducts(SAMPLE_PRODUCTS);
          setCategoryMeta(SAMPLE_CATEGORY_META);
          setUsingFallback(true);
        } else {
          setProducts([]);
          setUsingFallback(false);
        }""",
    """        setError(l10nErrorMessage(err, l10nRef.current, 'product-lookup-error-load'));
        applyUnavailableCatalog();""")

# the dependency comment describes the ternary that no longer exists
sub(U, """    // sessionToken is read at :132 and :133 to choose the scoped list calls. This is an effect,
    // not a callback, so the consequence differs from the stale-closure cases: the closure is
    // fresh whenever the effect RUNS, but nothing here re-runs it when the token changes. After""",
    """    // sessionToken is read in the effect body for both list calls. This is an effect, not a
    // callback, so the consequence differs from the stale-closure cases: the closure is fresh
    // whenever the effect RUNS, but nothing re-ran it when the token changed until it was added
    // to the dependency array below. After""")

# ── 2. the two wrappers go; their scoped twins stay ───────────────────────────────────────
sub(A, """/** List all products. */
export const listProducts = (): Promise<ProductDto[]> =>
  loggedInvoke<ProductDto[]>('list_products');

""", """""")

sub(A, """ * Prefer this over the unscoped `listProducts()` in multi-store
 * deployments.""",
    """ * This is the only door: the unscoped `list_products` it used to be preferred over is gone (T21)
 * -- neither shell registers it, and the desktop has no body for it at all, so "prefer this" was
 * describing a choice between one working call and one that cannot.""")

sub(A, """/** List all product categories. */
export const listCategories = (): Promise<CategoryDto[]> =>
  loggedInvoke<CategoryDto[]>('list_categories');

""", """""")

sys.exit(1 if fails else 0)
