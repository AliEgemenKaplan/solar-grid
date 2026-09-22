import { useDashboard } from '../app/dashboard-context';
import type { Resource } from '../hooks/use-resource';
import { HouseholdRankings } from '../components/households/HouseholdRankings';
import { HouseholdTables } from '../components/households/HouseholdTables';
import { useHouseholdDetail } from '../components/households/use-household-detail';
import { Card, Figure, Section } from '../components/ui/layout';
import { Skeleton } from '../components/ui/primitives';
import { formatCount } from '../utils/format';

/**
 * Who produces, uses, sells and buys. There is no household register in the
 * system: a household appears because it reported a reading or traded, so
 * every count here is of households that did something in the period.
 */
export function HouseholdsPage() {
  const { period, data, timeWindow, refreshToken } = useDashboard();
  const detail = useHouseholdDetail();

  return (
    <>
      <Section
        title="Households in the period"
        description={`${period}. Each service counts the households it saw, so the numbers answer different questions.`}
      >
        <Card>
          <dl className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <Count
              label="Sent meter readings"
              help="Households whose meter reported at least once in the period."
              resource={data.energy}
              value={(section) => section.summary.households}
            />
            <Count
              label="Part of a trade"
              help="Households on either side of a trade made in the period, whatever became of the trade."
              resource={data.market}
              value={(section) => section.summary.households}
            />
            <Count
              label="Settled a trade"
              help="Households with a ledger entry in the period."
              resource={data.billing}
              value={(section) => section.summary.ledger.households}
            />
            <Count
              label="Have a balance"
              help="Households that have ever settled a trade - not limited to the period."
              resource={data.billing}
              value={(section) => section.summary.balances.households}
            />
          </dl>
        </Card>
      </Section>

      <Section
        title="Rankings"
        description="In the order each service ranks households. Select one for its details."
      >
        <HouseholdRankings
          timeWindow={timeWindow}
          refreshToken={refreshToken}
          onSelect={detail.open}
        />
      </Section>

      <Section
        title="All households"
        description="Search by household ID. Select Details for everything the services know about one household."
      >
        <HouseholdTables
          timeWindow={timeWindow}
          refreshToken={refreshToken}
          onSelect={detail.open}
        />
      </Section>
      {detail.drawer}
    </>
  );
}

function Count<T>({
  label,
  help,
  resource,
  value,
}: {
  label: string;
  help: string;
  resource: Resource<T>;
  value: (data: T) => number;
}) {
  if (resource.status === 'loading') {
    return (
      <div role="status">
        <span className="sr-only">Loading {label}</span>
        <Skeleton className="h-12" />
      </div>
    );
  }
  return (
    <Figure
      label={label}
      help={help}
      value={resource.data ? formatCount(value(resource.data)) : 'Not available'}
    />
  );
}
