//! Designed card visuals for the analytics grid — the DISPATCHER.
//!
//! The seventeen-paragraph story of this file's decomposition: the shared
//! primitives live in `cards/shared/**`, the sixteen cards in `cards/*.tsx`
//! (seven chart-free in Phase 2.2, nine chart-bearing shells in Phase 2.3),
//! and every echarts option builder in `charts/*.tsx` behind the frozen
//! signature table. What remains here is the cardKey switch and the two
//! public surfaces that predate the split: `AnalyticsCardContent` (the
//! screen renders it) and `ExportCsvButton` (screen + test import it from
//! this exact path — agents-2 constraint 2 keeps the re-export).
//!
//! Behaviour notes inherited by the cards: every card runs on real backend
//! data through CARD_LOADERS; comparison mode overlays the previous
//! equal-length period per card (delta chips + chart overlays).

import type { AnalyticsQuery } from './analytics-data';
import type { Granularity, WorkspaceView } from './utils/dateRangePresets';
import { AovCard } from './cards/AovCard';
import { BasketCard } from './cards/BasketCard';
import { CategoryCard } from './cards/CategoryCard';
import { CustomersCard } from './cards/CustomersCard';
import { DiscountsCard } from './cards/DiscountsCard';
import { InventoryCard } from './cards/InventoryCard';
import { LowStockCard } from './cards/LowStockCard';
import { OccupancyCard } from './cards/OccupancyCard';
import { PaymentsCard } from './cards/PaymentsCard';
import { RefundsCard } from './cards/RefundsCard';
import { RevenueCard } from './cards/RevenueCard';
import { StaffCard } from './cards/StaffCard';
import { TablesCard } from './cards/TablesCard';
import { TopItemsCard } from './cards/TopItemsCard';
import { VoidsCard } from './cards/VoidsCard';
import { WaitstaffCard } from './cards/WaitstaffCard';
import { ExportCsvButton } from './cards/shared/ExportCsvButton';

/** Re-export, not relocation: the screen and the test import this exact
 *  name from this exact path. */
export { ExportCsvButton };

export interface AnalyticsCardContentProps {
  /** Card key from ANALYTICS_CARDS (e.g. 'revenue', 'top-items'). */
  cardKey: string;
  granularity: Granularity;
  /** Workspace view — differentiates retail vs restaurant card data. */
  workspaceView: WorkspaceView;
  /** Inclusive date range backing the query (derived from granularity). */
  from: string;
  to: string;
  /** Session token for the scoped reporting commands. */
  sessionToken: string;
  /** Localized card title, used as the chart's accessible name. */
  title: string;
  /** When true the card fills the main area — charts grow and lists uncap. */
  expanded?: boolean | undefined;
  /** When true cards overlay the previous equal-length period. */
  compare?: boolean | undefined;
}

/** Renders the designed content for a non-heatmap analytics card. */
export function AnalyticsCardContent({
  cardKey,
  granularity,
  workspaceView,
  from,
  to,
  sessionToken,
  title,
  expanded,
  compare,
}: AnalyticsCardContentProps) {
  const q: AnalyticsQuery = { workspace: workspaceView, granularity, from, to, sessionToken };
  switch (cardKey) {
    case 'revenue': return <RevenueCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'aov': return <AovCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'staff': return <StaffCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'customers': return <CustomersCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'payments': return <PaymentsCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'discounts': return <DiscountsCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'refunds': return <RefundsCard q={q} compare={compare} />;
    case 'top-items': return <TopItemsCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'category': return <CategoryCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'basket': return <BasketCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'inventory': return <InventoryCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'low-stock': return <LowStockCard q={q} title={title} expanded={expanded} />;
    case 'tables': return <TablesCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'occupancy': return <OccupancyCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'waitstaff': return <WaitstaffCard q={q} title={title} expanded={expanded} compare={compare} />;
    case 'voids': return <VoidsCard q={q} title={title} expanded={expanded} compare={compare} />;
    default: return null;
  }
}
