import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocalization } from '@fluent/react';
import AdminLockedFeature from '@/components/AdminLockedFeature';
import { listLocationsScoped, createLocationProfileScoped, updateLocationProfileScoped, deleteLocationProfileScoped, type LocationProfile } from '@/api/locations';
import {
  listWorkspacesScoped,
  updateWorkspaceInstanceScoped,
  type WorkspaceDto,
} from '@/api/workspaces';
import {
  loadTopology,
  loadTopologyRevision,
  type TopologyApplyResult,
  type TopologyData,
} from '@/api/topology';
import { isTopologyInstance } from './topologyContract';
import TopologyRevisionBrowser from './TopologyRevisionBrowser';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasGrantedPermission } from '@/registries/page-registry';
import { useSubscription, useAdminGate } from '@/contexts/SubscriptionContext';
import { LocaleContext } from '@/i18n/LocaleContext';
import { useContext } from 'react';
import { useToast } from '@/components/Toast';
import { requiredLocalized } from '@/components';
import { plainErrorMessage, l10nErrorMessage } from '@/utils/app-error';
import { openUpgradePricing } from '@/utils/upgrade';
import SettingsSelect from '@/features/settings/SettingsSelect';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import './TopologyScreen.css';
import NodeTopologyEditor, {
  type TopologyNodeData,
  type TopologyWireData,
  type WorkspaceInstanceSeed,
  type BranchLocationSeed,
} from './NodeTopologyEditor';
import { applyTopologyWithDiagram } from './topologyApply';
import {
  buildTopologyOverlay,
  compareBranchTopologies,
  type TopologyOverlay,
  type BranchTopologyComparison,
} from './topologyBranchCompare';

/**
 * Dedicated topology screen — the single home for the node-based store
 * topology builder. Owns loading of real workspace instances, license tier,
 * seeding the editor, and the create/update/archive bridge to
 * `workspace_instances` on save.
 *
 * This is intentionally separate from the Stores dashboard: "Stores" manages
 * store profiles only, while topology is its own concern (ADR #7 IA cleanup).
 */
/**
 * Deep-link hints from the Locations dashboard's entry points
 * (todo-global-saas-2 §"Locations and Topology navigation"): the editor
 * can arrive pre-scoped to one location, or with the Add Branch form armed
 * for the creation hand-off. Both are mount-time hints — the settings hub
 * remounts the section body per activeSection, so a fresh deep link always
 * reaches a freshly mounted editor and later hint changes remount via the
 * wrapper's key.
 */
export interface TopologyScreenProps {
  /** Open the editor scoped to this branch (a LocationProfile id carried
   *  in the `#/settings/topology?branch=<id>` deep link). A stale id — the
   *  location deleted between the dashboard click and this mount — falls
   *  back to the standard default branch instead of stranding an unowned
   *  canvas with a ghost selector option. */
  initialBranchId?: string | null;
  /** Arrive with the Add Branch form armed (`?create=1` deep link):
   *  location creation begins from Locations for discoverability; the
   *  editor owns the actual profile mutation and the workspace/terminal/
   *  KDS/warehouse/routing configuration that follows. */
  openCreateOnMount?: boolean;
}

/**
 * §B administrative gate (todo-global-saas-1.md): topology editing is an
 * administrative SaaS feature — the editor locks while the subscription is
 * not `active`. Location *viewing* stays operational (workspace picker,
 * dashboard); this screen is the management surface.
 */
export default function TopologyScreen({ initialBranchId, openCreateOnMount }: TopologyScreenProps = {}) {
  const { locked } = useAdminGate();
  if (locked) return <AdminLockedFeature />;
  return (
    <TopologyScreenContent
      {...(initialBranchId != null ? { initialBranchId } : {})}
      {...(openCreateOnMount ? { openCreateOnMount } : {})}
    />
  );
}

function TopologyScreenContent({ initialBranchId, openCreateOnMount }: TopologyScreenProps) {
  const { sessionToken, resolvedStoreId } = useWorkspace();
  const { session } = useAuth();
  const { addToast } = useToast();
  const { l10n } = useLocalization();
  /** Whether the session user may persist topology changes. The backend
   *  capability probe is authoritative for Apply and rename actions. */
  const [storesUnavailable, setStoresUnavailable] = useState(false);
  const [instancesUnavailable, setInstancesUnavailable] = useState(false);
  const [topologyUnavailable, setTopologyUnavailable] = useState(false);
  const handleTopologyLoadError = useCallback(() => {
    setTopologyUnavailable(true);
  }, []);
  const handleTopologyLoadSuccess = useCallback(() => {
    setTopologyUnavailable(false);
  }, []);
  // Determine save permission client-side, on the SAME key the write commands
  // authorize with: `topology:write` (platform/core/src/rbac.rs TOPOLOGY_WRITE)
  // — every topology mutation gate checks it (`kasirmu-bridge` topology
  // commands.rs:45 capability probe, :79 authorize_topology_write, :255
  // pin_topology_revision, :479 apply path). This block used to test
  // `staff:update`, a key the Manager preset carries (rbac_presets.rs:75) and
  // the topology commands do NOT accept — so a manager got an enabled Apply
  // the kernel always refused (the reachable path: `#/settings/topology` is
  // gated by role, `settings/register.tsx:10` requiredRole 'manager', and
  // MultiStoreDashboardScreen offers exactly that deep link).
  //
  // `hasGrantedPermission` mirrors the backend matcher (exact / `*` /
  // `<domain>:*`), which is what keeps Owner — whose preset grants only
  // `["*"]` (rbac_presets.rs:46) — enabled. A raw
  // `perms.includes('topology:write')` would lock Owner out of their own
  // screen, which is why the helper is mandatory here.
  //
  // Still deliberately no IPC: the earlier note cited "a flaky IPC round-trip
  // that fails when the session token hasn't resolved yet or the backend check
  // hits a transient error". That motivation is unchanged (and `tablet` registers
  // zero topology commands, so a probe would answer nothing on that shell at
  // all). The backend stays authoritative — each command re-checks.
  const canSaveTopology = useMemo(() => {
    if (!session) return false;
    return hasGrantedPermission(session.permissions, 'topology:write');
  }, [session]);
  // ADR #46 §8: the same client-side rule as canSaveTopology, but for the
  // READ gate. The commands themselves check `audit:view` server-side; this
  // only decides whether to offer the button, so a user without the
  // permission is not shown a control that would fail on click.
  //
  // Same helper, for the same reason: `hasGrantedPermission` mirrors the
  // backend matcher (exact / `*` / `<domain>:*`), so a custom role granted
  // `audit:*` — which the kernel DOES authorize for the history read — is not
  // denied its own control here. The raw `includes('*') || includes('audit:view')`
  // this replaces matched only two of those three forms, denying `audit:*`.
  const canViewTopologyHistory = useMemo(() => {
    if (!session) return false;
    return hasGrantedPermission(session.permissions, 'audit:view');
  }, [session]);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The branch's SAVED diagram, fetched when the browser opens. Deliberately
   *  not the canvas: `loadCompare` above makes the same choice — "comparing
   *  the saved states, not the possibly-unsaved canvas in front of the user".
   *  A revision diffed against unsaved edits would report changes the operator
   *  made locally and never deployed. */
  const [historyCurrent, setHistoryCurrent] = useState<TopologyData | null>(null);
  // ── ADR #46 §5: restore-to-draft (Phase 2) ──
  /** The revision graph armed onto the editor's restoreSeed prop. The
   *  screen owns the fetch (loadTopologyRevision), the unsaved-edit guard
   *  (same discard-confirm the branch switch uses), and clearing: after a
   *  successful Apply (the draft became the new revision) and on branch
   *  switch. The editor never arms itself. */
  const [restoreDraft, setRestoreDraft] = useState<TopologyData | null>(null);
  /** Revision currently being armed (browser button in-flight state). */
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);

  /** Real workspace instances loaded from the backend, used to seed the editor. */
  const [workspaceInstances, setWorkspaceInstances] = useState<WorkspaceDto[]>([]);
  const [stores, setStores] = useState<LocationProfile[]>([]);
  /** Branch (store profile) whose topology graph is on canvas. Deliberately
   *  NOT seeded from the deep link here: a hint naming a location that was
   *  deleted between the dashboard click and this mount must fall back to
   *  the ordinary default, and that validation needs the loaded store list
   *  — the defaulting effect below consumes deepLinkBranchRef instead. */
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  /** §15 deep-link branch scope, captured once at mount. Consumed by the
   *  defaulting effect below — a later selection is the user's, and the
   *  hint must not fight it. */
  const deepLinkBranchRef = useRef<string | null>(initialBranchId ?? null);
  /** Latest dirty flag from the editor (a ref: the branch selector's
   *  onChange is not a render path, and the flag changes on every edit).
   *  The editor reports it via onDirtyChange — the guard for a dirty
   *  branch switch must live HERE because the editor cannot veto its own
   *  keyed remount. */
  const editorDirtyRef = useRef(false);
  /** Branch id stashed when a dirty switch is intercepted — the confirm
   *  dialog's target. Null while no discard prompt is pending. */
  const [discardPendingBranchId, setDiscardPendingBranchId] = useState<string | null>(null);
  const handleEditorDirtyChange = useCallback((dirty: boolean) => {
    editorDirtyRef.current = dirty;
  }, []);
  // ── ADR #46 §5: restore-to-draft (Phase 2) ────────────────────────
  /** Revision stashed when a restore is intercepted by a dirty canvas —
   *  the discard-confirm's target. Null while no prompt is pending. */
  const [discardPendingRestore, setDiscardPendingRestore] = useState<number | null>(null);
  /** Fetch the revision's graph and arm it on the editor's restoreSeed
   *  prop. §5's contract holds by construction: this only LOADS a draft —
   *  the Apply that publishes it is the editor's existing dialog, against
   *  the LIVE revision for CAS, producing a NEW revision. Never
   *  auto-applies. A deflated/not-found row (pruned under us between list
   *  and click) reports honestly instead of seeding nothing. */
  const armRestoreDraft = useCallback(
    async (revision: number) => {
      if (!sessionToken) return;
      setRestoringRevision(revision);
      try {
        const graph = await loadTopologyRevision(sessionToken, revision, selectedBranchId ?? undefined);
        if (graph.status !== 'restorable' || !graph.diagram) {
          addToast({ message: l10n.getString('topology-rev-browser-restore-unavailable'), type: 'error' });
          return;
        }
        // The compare preview and the draft both own the canvas view — the
        // draft supersedes any live preview, so clear it.
        setCompareOverlay(null);
        setRestoreDraft(graph.diagram);
        setHistoryOpen(false);
        addToast({ message: l10n.getString('topology-rev-browser-restore-notice'), type: 'info' });
      } catch (err) {
        addToast({ message: plainErrorMessage(err), type: 'error' });
      } finally {
        setRestoringRevision(null);
      }
    },
    [sessionToken, selectedBranchId, addToast, l10n],
  );
  /** The browser's restore affordance: intercept on a dirty canvas (the
   *  seed would silently discard unsaved edits) with the same class of
   *  discard-confirm the branch switch uses, else arm directly. */
  const handleRestoreDraft = useCallback(
    (revision: number) => {
      if (editorDirtyRef.current) {
        setDiscardPendingRestore(revision);
        return;
      }
      void armRestoreDraft(revision);
    },
    [armRestoreDraft],
  );
  const [addingBranch, setAddingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  /** Two-step branch deletion: armed state + in-flight guard. The target
   *  id is captured at arm time so a mid-confirm branch switch can neither
   *  change what the confirm message names nor what the button deletes. */
  const [deletingBranch, setDeletingBranch] = useState(false);
  const [deleteBranchSaving, setDeleteBranchSaving] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  /** ── Branch-to-branch comparison panel (round 154) ────────────
   *  Compares the selected branch's saved diagram against another
   *  branch's, so an operator can see how two locations' topologies
   *  differ before editing either one. Display-only — it never
   *  resolves store ownership or builds apply payloads. */
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareOtherBranchId, setCompareOtherBranchId] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<BranchTopologyComparison | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  /** Spatial overlay (round 158): the other branch's topology rendered over
   *  the canvas while the compare panel is open — other-only workspaces as
   *  ghost cards at their saved positions, current-only and differing ones
   *  as card markers. Computed from the same saved-vs-saved comparison the
   *  panel summarises, so the canvas and the name lists can never disagree. */
  const [compareOverlay, setCompareOverlay] = useState<TopologyOverlay | null>(null);
  /** Compare-focus mode (round 162): dim shared-identical cards so only
   *  the differences stay bright. Lives with the panel — cleared on close. */
  const [compareFocus, setCompareFocus] = useState(false);

  /** Set once the first stores/listStores resolution lands — before that,
   *  the seeds must read as undefined ("not supplied yet") rather than the
   *  initial empty array, or the editor's load would treat the not-yet-
   *  loaded placeholder as an authoritative empty store and wipe the canvas
   *  (or flash the onboarding hint) before the real data arrives. */
  const storesResolvedRef = useRef(false);
  /** Same gate for the workspace-instances list (setWorkspaceInstances). */
  const instancesResolvedRef = useRef(false);

  const load = useCallback(async () => {
    // No tier fetch here. The header badge is derived from `caps` further down,
    // which is the same source the backend quota gate reads — see `licenseTier`.

    if (!sessionToken) return; // not ready yet — effect re-runs when it resolves

    try {
      const storeData = await listLocationsScoped(sessionToken);
      setStores(storeData);
      setStoresUnavailable(false);
      storesResolvedRef.current = true;
    } catch (err) {
      // A failed authoritative fetch is not an empty store list. Preserve
      // last-known data and disable Apply until the user can retry safely.
      setStoresUnavailable(true);
      addToast({
        message: `${l10n.getString('topology-toast-load-error')}: ${plainErrorMessage(err)}`,
        type: 'error',
      });
    }
  }, [addToast, l10n, sessionToken]);

  /** Fetch the workspace instances for the selected branch. Runs on mount
   *  AND whenever the branch selector changes: each branch owns its own
   *  topology graph, so switching branches must load that branch's
   *  instances (and, via the editor's workspaceInstances effect, its saved
   *  diagram) instead of showing the previous branch's canvas. The default
   *  null→first-branch transition is NOT a user switch — it is the initial
   *  resolution, and the mount effect already loaded the instances. */
  const loadWorkspaceInstances = useCallback(async () => {
    if (!sessionToken) {
      setWorkspaceInstances([]);
      return;
    }
    try {
      setWorkspaceInstances((await listWorkspacesScoped(sessionToken)).filter(isTopologyInstance));
      instancesResolvedRef.current = true;
      setInstancesUnavailable(false);
    } catch (err) {
      // Never turn a transient workspace-list failure into an authoritative
      // empty list; that could make Apply persist an incomplete graph.
      setInstancesUnavailable(true);
      addToast({
        message: `${l10n.getString('topology-toast-load-error')}: ${plainErrorMessage(err)}`,
        type: 'error',
      });
    }
  }, [sessionToken, addToast, l10n]);

  /** Load both diagrams and compute the comparison. Fetching both fresh
   *  from the backend keeps the panel honest — it compares the saved
   *  states, not the possibly-unsaved canvas in front of the user. */
  const loadCompare = useCallback(async (otherBranchId: string) => {
    // R1: the read is sessioned; the screen's house guard (same shape as
    // the revision-fetch callback's) — no session, no compare fetch.
    if (!sessionToken) return;
    setCompareLoading(true);
    try {
      const [currentData, otherData] = await Promise.all([
        loadTopology(sessionToken, selectedBranchId ?? undefined),
        loadTopology(sessionToken, otherBranchId),
      ]);
      setCompareResult(compareBranchTopologies(currentData, otherData));
      setCompareOverlay(buildTopologyOverlay(currentData, otherData));
    } catch (err) {
      setCompareResult(null);
      addToast({
        message: `${l10n.getString('topology-compare-load-error')}: ${plainErrorMessage(err)}`,
        type: 'error',
      });
    } finally {
      setCompareLoading(false);
    }
  }, [selectedBranchId, sessionToken, addToast, l10n]);

  /** Open the compare panel against the first other branch. */
  const openCompare = useCallback(() => {
    const otherId = stores.find((s) => s.id !== selectedBranchId)?.id ?? null;
    setCompareOtherBranchId(otherId);
    setCompareOpen(true);
    if (otherId !== null) void loadCompare(otherId);
  }, [stores, selectedBranchId, loadCompare]);

  const closeCompare = useCallback(() => {
    setCompareOpen(false);
    setCompareResult(null);
    setCompareOverlay(null);
    setCompareFocus(false);
  }, []);

  // Keep the comparison honest across branch changes. The target is
  // captured once by openCompare and only edited through the panel's own
  // select — nothing re-derives it when the SELECTED branch moves, so a
  // main-selector switch onto the target (or a deletion that moves
  // selection onto it) would compare a branch with itself. Whenever the
  // selected branch changes: close the panel when no other branch remains,
  // otherwise re-point a null/self/stale target at the first other branch
  // (a user-chosen target that still exists is preserved).
  useEffect(() => {
    if (!compareOpen) return;
    const others = stores.filter((s) => s.id !== selectedBranchId);
    if (others.length === 0) {
      closeCompare();
      return;
    }
    if (
      compareOtherBranchId === null ||
      compareOtherBranchId === selectedBranchId ||
      !others.some((s) => s.id === compareOtherBranchId)
    ) {
      setCompareOtherBranchId(others[0]!.id);
    }
  }, [compareOpen, stores, selectedBranchId, compareOtherBranchId, closeCompare]);

  // Recompute when the user picks a different comparison target. Never
  // fetch when the target IS the selected branch — the re-derive effect
  // above re-points that state; this guard just keeps a transient
  // intermediate render from issuing a self-comparison fetch.
  useEffect(() => {
    if (!compareOpen || compareOtherBranchId === null || compareOtherBranchId === selectedBranchId) return;
    void loadCompare(compareOtherBranchId);
  }, [compareOpen, compareOtherBranchId, selectedBranchId, loadCompare]);

  useEffect(() => { void load(); }, [load]);
  // Mount: load the default branch's instances once.
  useEffect(() => { void loadWorkspaceInstances(); }, [loadWorkspaceInstances]);
  // Branch switch: reload that branch's graph. The ref ignores the initial
  // null→default resolution (already loaded on mount) so a genuine change
  // is the only thing that triggers a refetch.
  useEffect(() => {
    if (selectedBranchId === null || selectedBranchId === lastBranchRef.current) return;
    lastBranchRef.current = selectedBranchId;
    void loadWorkspaceInstances();
  }, [selectedBranchId, loadWorkspaceInstances]);

  /** The branch whose graph is currently loaded on canvas. Lets the
   *  branch-switch refetch effect below distinguish a genuine user switch
   *  from the initial null→default resolution (whose instances were already
   *  loaded on mount). Initialized by the defaulting effect below. */
  const lastBranchRef = useRef<string | null>(null);

  /** Default the selector to the session's resolved store when available.
   *  The default branch is resolved ONCE — record it so the branch-switch
   *  refetch effect skips the initial null→default transition (the mount
   *  effect already loaded those instances).
   *
   *  A deep-linked branch hint (Locations → Configure topology) takes
   *  precedence over the session default but is still validated against
   *  the loaded list: the Locations dashboard's click and this mount are
   *  two different fetches, and the location could have been deleted in
   *  between — the stale-hint fallback keeps the editor on an owned
   *  branch instead of a ghost selector value over an empty graph. The
   *  hint is consumed once; afterwards the user's own selection wins. */
  useEffect(() => {
    setSelectedBranchId((prev) => {
      if (prev) {
        if (lastBranchRef.current === null) lastBranchRef.current = prev;
        return prev;
      }
      const deepLinkId = deepLinkBranchRef.current;
      if (deepLinkId !== null && stores.some((s) => s.id === deepLinkId)) {
        deepLinkBranchRef.current = null;
        lastBranchRef.current = deepLinkId;
        return deepLinkId;
      }
      if (deepLinkId !== null && storesResolvedRef.current) {
        // Stale hint confirmed dead — drop it so a later store-list refresh
        // cannot resurrect it over a healthy default.
        deepLinkBranchRef.current = null;
      }
      const next = resolvedStoreId && stores.some((s) => s.id === resolvedStoreId)
        ? resolvedStoreId
        : stores[0]?.id ?? null;
      if (next !== null) lastBranchRef.current = next;
      return next;
    });
  }, [resolvedStoreId, stores]);

  /** §15 creation hand-off: arrive with the Add Branch form armed. Deep-link
   *  only — a user who manually navigates to the section must not find the
   *  form open; this state is set here rather than in useState's initializer
   *  so it reads as the one-shot mount hint it is. */
  useEffect(() => {
    if (openCreateOnMount) setAddingBranch(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only hint
  }, []);

  /** Name of the branch armed for deletion, for the delete-confirm message. */
  const deleteTargetName = stores.find((s) => s.id === deleteTargetId)?.name ?? '';

  /** Seed the topology editor with real workspace instances for the selected branch. */
  const branchLocationSeed: BranchLocationSeed[] | undefined = useMemo(
    () => storesResolvedRef.current
      ? stores
        // A topology is branch-scoped: exactly one Branch Location root per
        // graph. The selector picks which branch's graph is on canvas; without
        // a selected branch the graph stays visibly unowned and is blocked by
        // semantic validation rather than guessing a fallback.
        .filter((store) => selectedBranchId === null || store.id === selectedBranchId)
        .map((store) => ({ id: store.id, name: store.name }))
      : undefined,
    [stores, selectedBranchId],
  );

  const workspaceSeed: WorkspaceInstanceSeed[] | undefined = useMemo(
    () => instancesResolvedRef.current
      ? workspaceInstances
        .filter((w) => selectedBranchId === null || w.store_id === selectedBranchId)
        .map((w) => {
          const seed: WorkspaceInstanceSeed = {
            instanceId: w.instance_id,
            typeKey: w.type_key,
            purposeKey: w.purpose_key,
            storeId: w.store_id,
            storeName: w.store_name,
            name: w.name,
          };
          if (w.description) seed.subtitle = w.description;
          if (w.colour) seed.colour = w.colour;
          return seed;
        })
      : undefined,
    [workspaceInstances, selectedBranchId],
  );

  // C2.2: second-location gate (Plus→Pro trigger) — the tier's
  // `max_locations()` quota caps how many location profiles can exist.
  const { caps, refresh: refreshCaps } = useSubscription();
  // The header tier is derived, not fetched. It used to call `checkLicenseStatus`,
  // which is a network probe to the license server: with no activated license it
  // rejects, and the `catch → 'free'` fallback then displayed FREE on a debug
  // build whose quota gate upgrades Free to Premium (`commands/subscription.rs`),
  // so the label contradicted the behaviour the same screen enforced. `caps`
  // comes from `get_subscription_capabilities` — local, no network, and the
  // owner of that debug override — so the badge now inherits the gate's answer
  // instead of duplicating it. `null` before first load stays conservatively
  // FREE rather than advertising a tier nothing has confirmed.
  const licenseTier = caps?.tier?.toLowerCase() ?? 'free';
  const locale = useContext(LocaleContext)?.locale ?? 'en';
  const atLocationLimit =
    caps !== null && caps.maxLocations !== null && caps.locationCount >= caps.maxLocations;

  const handleAddBranch = async () => {
    const name = newBranchName.trim();
    if (!name) return;
    if (atLocationLimit) return; // the inline banner explains why
    if (!sessionToken) {
      // Session not minted yet (admin-shell fallback race) — fail honestly
      // instead of sending a null token that yields the generic toast.
      addToast({
        message: `${l10n.getString('topology-branch-add-error')}: ${l10n.getString('topology-branch-session-pending')}`,
        type: 'error',
      });
      return;
    }
    try {
      const created = await createLocationProfileScoped(sessionToken, { id: `store-${crypto.randomUUID()}`, name });
      setStores((prev) => [...prev, created]);
      setSelectedBranchId(created.id);
      setAddingBranch(false);
      setNewBranchName('');
      // Keep the C2.2 gate honest: locationCount in caps just changed.
      refreshCaps();
    } catch (err) {
      addToast({
        message: `${l10n.getString('topology-branch-add-error')}: ${l10nErrorMessage(err, l10n)}`,
        type: 'error',
      });
    }
  };

  /** Delete the selected store profile. Its card, wires, and selector
   *  option leave the canvas cleanly: the stores-state update drops the
   *  selector option and the branchLocations seed, the editor's merge/
   *  rebuild drops the card + wires, and the selection moves to the next
   *  branch (or clears the canvas when none remain). */
  const handleDeleteBranch = async () => {
    if (!deleteTargetId) return;
    const id = deleteTargetId;
    if (!sessionToken) {
      addToast({
        message: `${l10n.getString('topology-branch-delete-error')}: ${l10n.getString('topology-branch-session-pending')}`,
        type: 'error',
      });
      return;
    }
    const remaining = stores.filter((s) => s.id !== id);
    setDeleteBranchSaving(true);
    try {
      await deleteLocationProfileScoped(sessionToken, id);
      setStores(remaining);
      setSelectedBranchId(remaining[0]?.id ?? null);
      // The editor remounts on this switch — drop any armed restore seed.
      setRestoreDraft(null);
      // No branches left: nothing owns the graph — clear the instances so
      // the remounted editor lands on a clean, unowned canvas.
      if (remaining.length === 0) setWorkspaceInstances([]);
      setDeleteTargetId(null);
      setDeletingBranch(false);
      // Keep the C2.2 gate honest: locationCount in caps just changed.
      refreshCaps();
    } catch (err) {
      addToast({
        message: `${l10n.getString('topology-branch-delete-error')}: ${plainErrorMessage(err)}`,
        type: 'error',
      });
    } finally {
      setDeleteBranchSaving(false);
    }
  };

  /** Persist a Branch Location rename (store profile) from the editor's
   *  card. Returns true on success so the card can close its inline form;
   *  false keeps the draft open for a retry. */
  const handleRenameBranch = useCallback(async (id: string, name: string): Promise<boolean> => {
    if (!canSaveTopology) {
      addToast({ message: l10n.getString('topology-rename-permission-error'), type: 'error' });
      return false;
    }
    const store = stores.find((s) => s.id === id);
    if (!store) return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === store.name) return false;
    if (!sessionToken) {
      addToast({
        message: `${l10n.getString('topology-branch-rename-error')}: ${l10n.getString('topology-branch-session-pending')}`,
        type: 'error',
      });
      return false;
    }
    try {
      const updated = await updateLocationProfileScoped(sessionToken, {
        id: store.id,
        name: trimmed,
        address: store.address,
        tax_id: store.tax_id,
        currency: store.currency,
        timezone: store.timezone,
      });
      setStores((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      return true;
    } catch (err) {
      addToast({
        message: `${l10n.getString('topology-branch-rename-error')}: ${plainErrorMessage(err)}`,
        type: 'error',
      });
      return false;
    }
  }, [stores, canSaveTopology, sessionToken, addToast, l10n]);

  /** Persist a workspace instance rename (the live row, not just the canvas
   *  label) from the editor's card. Same contract as handleRenameBranch. */
  const handleRenameWorkspace = useCallback(async (instanceId: string, name: string): Promise<boolean> => {
    if (!canSaveTopology) {
      addToast({ message: l10n.getString('topology-rename-permission-error'), type: 'error' });
      return false;
    }
    const ws = workspaceInstances.find((w) => w.instance_id === instanceId);
    if (!ws || !sessionToken) return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed === ws.name) return false;
    try {
      // The wrapper nulls omitted description/colour — pass the existing
      // values through so a rename never wipes the card subtitle/colour.
      await updateWorkspaceInstanceScoped(sessionToken, instanceId, {
        name: trimmed,
        description: ws.description,
        ...(ws.colour ? { colour: ws.colour } : {}),
      });
      setWorkspaceInstances((prev) => prev.map((w) => (w.instance_id === instanceId ? { ...w, name: trimmed } : w)));
      return true;
    } catch (err) {
      addToast({
        message: `${l10n.getString('topology-workspace-rename-error')}: ${plainErrorMessage(err)}`,
        type: 'error',
      });
      return false;
    }
  }, [workspaceInstances, sessionToken, canSaveTopology, addToast, l10n]);

  /**
   * Persist topology edits atomically (Critical #4 + #5):
   *
   * 1. Resolve store_id for each workspace node from topology wires.
   * 2. Detect typeKey changes on persisted nodes and implement archive +
   *    recreate (Critical #1) — type_key is immutable by backend contract.
   * 3. Diff workspace nodes against loaded instances, send creates,
   *    updates, and archives as a single atomic `apply_topology_diff` call.
   *
   * Returns an `oldId -> newId` map so the editor can remap the canvas
   * state when archive+recreate assigns new UUIDs.
   */
  const handleTopologySave = useCallback(
    async (
      nodes: TopologyNodeData[],
      wires: TopologyWireData[],
      baseRevision = 0,
      resolvedIssueKeys: string[] = [],
      // ADR #46 §6: threaded straight to the Apply IPC. The editor's dialog
      // collects it; this screen owns the IPC call, so it owns the mapping.
      changeNote?: string,
    ): Promise<TopologyApplyResult & { idMap?: Record<string, string> }> => {
      if (!sessionToken) {
        const error = new Error(l10n.getString('topology-toast-no-session'));
        addToast({ message: plainErrorMessage(error), type: 'error' });
        throw error;
      }

      const result = await applyTopologyWithDiagram(
        nodes, wires,
        {
          sessionToken,
          workspaceInstances,
          stores,
          licenseTier,
          branchId: selectedBranchId ?? undefined,
          baseRevision,
          resolvedIssueKeys,
          changeNote,
        },
        (msg, type) => addToast({ message: msg, type }),
        l10n,
      );

      // Refresh loaded instances in local state so subsequent saves diff correctly.
      if (result.refreshedInstances) {
        setWorkspaceInstances(result.refreshedInstances);
      }

      // §5: the restored draft was just published as a NEW revision — the
      // seed has served its purpose. Clearing it keeps the one-shot
      // contract honest and prevents a later editor reload from
      // re-seeding a stale graph.
      setRestoreDraft(null);

      return result;
    },
    [sessionToken, workspaceInstances, stores, addToast, l10n, licenseTier, selectedBranchId],
  );

  return (
    <div
      className="settings-topology-container"
      aria-label={requiredLocalized(l10n, 'settings-nav-topology')}
    >
      {/* Keying by branch makes each branch's topology a fresh editor
          session: switching branches remounts the canvas and loads that
          branch's saved diagram instead of leaking the previous branch's
          nodes onto the new graph. */}
      <NodeTopologyEditor
        key={selectedBranchId ?? 'unassigned'}
        branchId={selectedBranchId ?? 'unassigned'}
        currentTier={licenseTier as 'free' | 'one_time' | 'plus' | 'pro' | 'premium' | 'enterprise'}
        compareOverlay={compareOverlay}
        compareFocus={compareFocus}
        {...(workspaceSeed !== undefined ? { workspaceInstances: workspaceSeed } : {})}
        {...(branchLocationSeed !== undefined ? { branchLocations: branchLocationSeed } : {})}
        onRenameBranch={handleRenameBranch}
        onRenameWorkspace={handleRenameWorkspace}
        allowLegacyApply={false}
        onSave={handleTopologySave}
        restoreSeed={restoreDraft}
        canSave={canSaveTopology && !storesUnavailable && !instancesUnavailable && !topologyUnavailable}
        onDirtyChange={handleEditorDirtyChange}
        onLoadError={handleTopologyLoadError}
        onLoadSuccess={handleTopologyLoadSuccess}
        branchToolbar={(
          /* ── Branch (graph) selector toolbar, merged into the editor header ── */
          <div className="topology-branch-toolbar">
            <div className="topology-branch-selector">
              <label className="topology-branch-label" htmlFor="topology-branch-select">
                {l10n.getString('topology-branch-selector-label')}
              </label>
              <SettingsSelect
                id="topology-branch-select"
                value={selectedBranchId ?? ''}
                onChange={(id) => {
                  if (id === selectedBranchId) return;
                  // A branch switch drops any armed restore draft: the
                  // editor remounts, and the seed is one-shot for the
                  // branch it was armed on.
                  setRestoreDraft(null);
                  if (editorDirtyRef.current) {
                    // The canvas holds unsaved edits — switching would
                    // silently discard them (the editor remounts keyed by
                    // branch). Intercept and ask first.
                    setDiscardPendingBranchId(id);
                  } else {
                    setSelectedBranchId(id);
                  }
                }}
                options={stores.map((s) => ({ value: s.id, label: s.name }))}
                ariaLabel={l10n.getString('topology-branch-selector-aria')}
                /* With branches present a branch is always auto-selected, so
                   the placeholder never shows — it only surfaces when the
                   list settles empty, where the bare "Branch" label read
                   like a fake selected value sitting on an openable empty
                   dropdown. A failed store fetch also renders [] and must
                   not claim the branches don't exist ("No branches yet"
                   would lie — the load-error toast already fired), and the
                   pre-resolution window keeps the plain label so a slow IPC
                   roundtrip doesn't flash the empty-state text. */
                placeholder={
                  storesUnavailable
                    ? l10n.getString('topology-branch-selector-unavailable')
                    : storesResolvedRef.current && stores.length === 0
                      ? l10n.getString('topology-branch-selector-empty')
                      : l10n.getString('topology-branch-selector-label')
                }
                /* Nothing to pick while the list is empty (or still loading)
                   — disabling also keeps the empty dropdown popover closed;
                   the adjacent Add Branch button is the real action. */
                disabled={deletingBranch || stores.length === 0}
              />
            </div>
            {addingBranch && atLocationLimit && (
              <div className="topology-store-limit-banner" role="note">
                <span>{l10n.getString('location-limit-upgrade-pro', { max: caps?.maxLocations ?? 0 })}</span>
                <Button variant="primary" size="sm" onClick={() => openUpgradePricing(locale, 'pro')}>
                  {l10n.getString('location-limit-upgrade-cta')}
                </Button>
              </div>
            )}
            {deletingBranch ? null : addingBranch ? (
              <div className="topology-branch-add-form">
                <input
                  className="topology-branch-add-input"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleAddBranch(); if (e.key === 'Escape') { setAddingBranch(false); setNewBranchName(''); } }}
                  aria-label={l10n.getString('topology-branch-add-name-placeholder')}
                  placeholder={l10n.getString('topology-branch-add-name-placeholder')}
                />
                <Button variant="primary" onClick={() => void handleAddBranch()} disabled={!newBranchName.trim()}>
                  {l10n.getString('topology-branch-add-confirm')}
                </Button>
                <Button variant="secondary" onClick={() => { setAddingBranch(false); setNewBranchName(''); }}>
                  {l10n.getString('topology-branch-add-cancel')}
                </Button>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => { setDeleteTargetId(null); setDeletingBranch(false); setAddingBranch(true); }}>
                {l10n.getString('topology-branch-add')}
              </Button>
            )}
            {deletingBranch ? (
              <div className="topology-branch-delete-form">
                <span className="topology-branch-delete-msg">
                  {l10n.getString('topology-branch-delete-confirm', { name: deleteTargetName })}
                </span>
                <Button variant="danger" onClick={() => void handleDeleteBranch()} disabled={deleteBranchSaving}>
                  {l10n.getString('topology-branch-delete-confirm-btn')}
                </Button>
                <Button variant="secondary" onClick={() => { setDeleteTargetId(null); setDeletingBranch(false); }}>
                  {l10n.getString('topology-branch-add-cancel')}
                </Button>
              </div>
            ) : !addingBranch ? (
              <Button
                variant="secondary"
                onClick={() => { setAddingBranch(false); setDeleteTargetId(selectedBranchId); setDeletingBranch(true); }}
                disabled={!selectedBranchId}
              >
                {l10n.getString('topology-branch-delete')}
              </Button>
            ) : null}
            {stores.length >= 2 && selectedBranchId ? (
              <Button variant="secondary" onClick={() => openCompare()} disabled={compareOpen}>
                {l10n.getString('topology-compare-open')}
              </Button>
            ) : null}
            {canViewTopologyHistory && selectedBranchId ? (
              <Button
                variant="secondary"
                disabled={historyOpen}
                onClick={() => {
                  // Fetch the saved diagram first so the very first revision
                  // the operator selects can be diffed without a second round
                  // trip. R1: the read is sessioned — with no session, the
                  // panel degrades exactly like a failed fetch below.
                  if (!sessionToken) {
                    setHistoryOpen(true);
                    return;
                  }
                  void loadTopology(sessionToken, selectedBranchId)
                    .then((data) => {
                      setHistoryCurrent(data);
                      setHistoryOpen(true);
                    })
                    .catch(() => setHistoryOpen(true));
                }}
              >
                {l10n.getString('topology-history-open')}
              </Button>
            ) : null}
          </div>
        )}
      />

      {/* ── ADR #46 §2: deploy history browser ──────────────────────
          Sibling of the compare panel, not inside it — the two are
          independent affordances that happen to share the editor's single
          overlay slot. */}
      {historyOpen && sessionToken && selectedBranchId && (
        <TopologyRevisionBrowser
          sessionToken={sessionToken}
          branchId={selectedBranchId}
          currentGraph={historyCurrent}
          onClose={() => setHistoryOpen(false)}
          // Preview reuses the branch-compare overlay: the editor draws
          // whatever second graph it is handed and does not care that this one
          // came from the past. One slot means one preview at a time, so
          // previewing a revision replaces any live branch compare.
          onPreview={(graph) => {
            setCompareOverlay(
              historyCurrent && graph ? buildTopologyOverlay(historyCurrent, graph) : null,
            );
          }}
          onRestore={canSaveTopology ? handleRestoreDraft : undefined}
          restoringRevision={restoringRevision}
        />
      )}

      {/* ── Branch-to-branch comparison panel ───────────────────────
          Summarises how the selected branch's saved topology differs
          from another branch's — workspaces only here / only there /
          shared-but-differing — so an operator can see how locations
          differ before editing. Display-only. */}
      {compareOpen ? (
        <div className="topology-compare-panel" role="region" aria-label={l10n.getString('topology-compare-title')}>
          <div className="topology-compare-header">
            <h3>{l10n.getString('topology-compare-title')}</h3>
            <div className="topology-compare-header-actions">
              <Button
                variant="secondary"
                aria-pressed={compareFocus}
                onClick={() => setCompareFocus((f) => !f)}
              >
                {l10n.getString('topology-compare-focus')}
              </Button>
              <Button variant="secondary" onClick={() => closeCompare()}>
                {l10n.getString('topology-compare-close')}
              </Button>
            </div>
          </div>
          <div className="topology-compare-other">
            <label htmlFor="topology-compare-other-select">
              {l10n.getString('topology-compare-other-label')}
            </label>
            <SettingsSelect
              id="topology-compare-other-select"
              value={compareOtherBranchId ?? ''}
              onChange={(id) => setCompareOtherBranchId(id)}
              options={stores.filter((s) => s.id !== selectedBranchId).map((s) => ({ value: s.id, label: s.name }))}
              ariaLabel={l10n.getString('topology-compare-other-label')}
            />
          </div>
          {compareLoading ? (
            <p>{l10n.getString('topology-compare-loading')}</p>
          ) : compareResult ? (
            compareResult.onlyInCurrent.length === 0 &&
            compareResult.onlyInOther.length === 0 &&
            compareResult.differing.length === 0 ? (
              <p>{l10n.getString('topology-compare-none')}</p>
            ) : (
              <div className="topology-compare-summary">
                <p>
                  {l10n.getString('topology-compare-counts', {
                    onlyInCurrent: compareResult.onlyInCurrent.length,
                    onlyInOther: compareResult.onlyInOther.length,
                    differ: compareResult.differing.length,
                    otherBranch: stores.find((s) => s.id === compareOtherBranchId)?.name ?? compareOtherBranchId ?? '',
                  })}
                </p>
                {compareResult.onlyInCurrent.length > 0 ? (
                  <p>{l10n.getString('topology-compare-only-here', { names: compareResult.onlyInCurrent.map((w) => w.name).join(', ') })}</p>
                ) : null}
                {compareResult.onlyInOther.length > 0 ? (
                  <p>{l10n.getString('topology-compare-only-there', {
                    names: compareResult.onlyInOther.map((w) => w.name).join(', '),
                    otherBranch: stores.find((s) => s.id === compareOtherBranchId)?.name ?? compareOtherBranchId ?? '',
                  })}</p>
                ) : null}
                {compareResult.differing.length > 0 ? (
                  <p>{l10n.getString('topology-compare-differing', { names: compareResult.differing.map((w) => w.name).join(', ') })}</p>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      ) : null}

      {/* ── Dirty branch-switch guard: confirm before discarding unsaved
             edits. The controlled selector never changed — cancel leaves
             the current branch; confirm applies the stashed target. ── */}
      <ConfirmDialog
        open={discardPendingBranchId !== null}
        variant="warning"
        onCancel={() => setDiscardPendingBranchId(null)}
        onConfirm={() => {
          if (discardPendingBranchId !== null) {
            setSelectedBranchId(discardPendingBranchId);
          }
          // The editor remounts on branch switch — a stale restore seed
          // must not re-fire onto the new branch's graph.
          setRestoreDraft(null);
          setDiscardPendingBranchId(null);
        }}
        title={l10n.getString('topology-discard-changes-title')}
        message={l10n.getString('topology-discard-changes-msg', {
          name: stores.find((s) => s.id === discardPendingBranchId)?.name ?? discardPendingBranchId ?? '',
        })}
        confirmLabel={l10n.getString('topology-discard-changes-confirm')}
      />

      {/* ── §5 restore over a dirty canvas: the editor's restoreSeed would
          silently discard unsaved edits, so the same discard-confirm class
          intercepts first. Confirm discards and arms; cancel keeps both. ── */}
      <ConfirmDialog
        open={discardPendingRestore !== null}
        variant="warning"
        onCancel={() => setDiscardPendingRestore(null)}
        onConfirm={() => {
          const revision = discardPendingRestore;
          setDiscardPendingRestore(null);
          if (revision !== null) void armRestoreDraft(revision);
        }}
        title={l10n.getString('topology-restore-discard-title')}
        message={l10n.getString('topology-restore-discard-body')}
        confirmLabel={l10n.getString('topology-restore-discard-confirm')}
      />
    </div>
  );
}
