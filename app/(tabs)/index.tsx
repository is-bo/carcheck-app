import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router, type Href } from 'expo-router';
import { Clock, HardDrive, KeyRound, Plus, Search, TriangleAlert } from 'lucide-react-native';

import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Fab,
  Icon,
  ListRow,
  ListSection,
  PlateFrame,
  ProgressTicks,
  Screen,
  SkeletonRows,
  Text,
  TextField,
  formatRelativeDateTime,
  plural,
  showToast,
} from '@/ui';
import { fontFamily, layout } from '@/ui/theme/tokens';
import { getBackupStatus } from '@/data/backup';
import { discardDraft, getHome, isAgencyConfigured, listRentals, searchRentals, startReturn } from '@/data/repos';
import type { DataEntity } from '@/data/repos';
import type { RentalListItem } from '@/domain/types';
import { crossAgent, dueBackMeta, rentalSubtitle, returnedStatusLine, unfinishedMeta, useLiveQuery } from '@/features/entities';

// Rentals home (UX_FLOWS §1): Unfinished / Due back / Out / Returned, search, New rental FAB.
// Redirects to onboarding on first launch, per this wave's task brief.
const HOME_WATCH: readonly DataEntity[] = ['rental', 'inspection', 'photo', 'damage', 'contract'];
const BACKUP_WATCH: readonly DataEntity[] = ['backup'];

export default function RentalsScreen() {
  const [agencyChecked, setAgencyChecked] = useState(false);
  const [agencyConfigured, setAgencyConfigured] = useState(true);
  useEffect(() => {
    let alive = true;
    isAgencyConfigured().then((v) => {
      if (alive) {
        setAgencyConfigured(v);
        setAgencyChecked(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const home = useLiveQuery(getHome, HOME_WATCH);
  const backup = useLiveQuery(getBackupStatus, BACKUP_WATCH);
  const [backupBannerDismissed, setBackupBannerDismissed] = useState(false);
  const [now] = useState(() => Date.now());

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RentalListItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    // Below the search field, rendering already switches on `searchActive` (query.trim()), so a
    // cleared query just leaves this stale state unrendered rather than resetting it here.
    const q = query.trim();
    if (!q) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      searchRentals(q).then((rows) => {
        if (alive) {
          setSearchResults(rows);
          setSearching(false);
        }
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const [returnedExpanded, setReturnedExpanded] = useState<RentalListItem[] | null>(null);
  const [returnedExpanding, setReturnedExpanding] = useState(false);
  const expandReturned = () => {
    setReturnedExpanding(true);
    listRentals({ statuses: ['returned'], limit: 200 }).then((rows) => {
      setReturnedExpanded(rows);
      setReturnedExpanding(false);
    });
  };

  const [discardTarget, setDiscardTarget] = useState<RentalListItem | null>(null);
  const [discarding, setDiscarding] = useState(false);

  if (!agencyChecked) return null;
  if (!agencyConfigured) return <Redirect href={crossAgent.onboarding} />;

  async function handleReturn(id: string) {
    try {
      await startReturn(id);
      router.push(crossAgent.returnEntry(id));
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't start the return.");
    }
  }

  function openRental(id: string) {
    router.push(crossAgent.rental(id));
  }

  /** Unfinished rows: hand off to whichever flow owns this rental's next step. */
  function resume(item: RentalListItem) {
    router.push(item.derived.returnInProgress ? crossAgent.returnEntry(item.rental.id) : crossAgent.startEntry(item.rental.id));
  }

  const rowTitle = (item: RentalListItem) =>
    item.rental.vehicle ? <PlateFrame plate={item.rental.vehicle.plate} /> : 'New rental';
  const rowSubtitle = (item: RentalListItem) =>
    item.rental.vehicle ? rentalSubtitle(item.rental) : (item.rental.customer.fullName ?? undefined);

  const searchActive = query.trim().length > 0;
  const sections = home.data;
  const allEmpty = !!sections && !sections.unfinished.length && !sections.dueBack.length && !sections.out.length && !sections.returned.length;

  return (
    <Screen
      insets={{ top: false, bottom: false }}
      scroll
      overlay={
        <>
          <Fab icon={Plus} label="New rental" onPress={() => router.push(crossAgent.rentalNew)} />
          <ConfirmDialog
            visible={!!discardTarget}
            title="Discard this draft?"
            message="Photos taken for it will be deleted."
            confirmLabel="Discard"
            busy={discarding}
            onCancel={() => setDiscardTarget(null)}
            onConfirm={async () => {
              if (!discardTarget) return;
              setDiscarding(true);
              try {
                await discardDraft(discardTarget.rental.id);
                showToast('Draft discarded');
                setDiscardTarget(null);
              } catch (e) {
                showToast(e instanceof Error ? e.message : "Couldn't discard the draft.");
              } finally {
                setDiscarding(false);
              }
            }}
          />
        </>
      }
    >
      <View style={styles.searchWrap}>
        <TextField
          variant="search"
          placeholder="Plate, name or R-number"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {!searchActive && backup.data?.reminder.due && !backupBannerDismissed ? (
        <Banner
          icon={HardDrive}
          message={
            backup.data.reminder.daysSince === null
              ? "Back up your data — you haven't backed up yet."
              : `Back up your data — last backup ${plural(backup.data.reminder.daysSince, '{n} day ago', '{n} days ago')}.`
          }
          action={
            <View style={styles.bannerActions}>
              <Button label="Back up" variant="quiet" onPress={() => router.push('/settings/backup' as Href)} />
              <Button label="Dismiss" variant="quiet" onPress={() => setBackupBannerDismissed(true)} />
            </View>
          }
        />
      ) : null}

      {searchActive ? (
        searching && !searchResults ? (
          <SkeletonRows count={3} />
        ) : searchResults && searchResults.length > 0 ? (
          <ListSection flush>
            {searchResults.map((item) => (
              <ListRow
                key={item.rental.id}
                title={rowTitle(item)}
                subtitle={rowSubtitle(item)}
                meta={item.rental.reference}
                onPress={() => openRental(item.rental.id)}
              />
            ))}
          </ListSection>
        ) : (
          <EmptyState icon={Search} title={`No matches for "${query.trim()}"`} body="Try a plate, name or reference number." />
        )
      ) : home.loading && !sections ? (
        <SkeletonRows count={4} />
      ) : home.error ? (
        <EmptyState
          icon={TriangleAlert}
          title="Couldn't load rentals"
          body={home.error instanceof Error ? home.error.message : String(home.error)}
          action={<Button label="Try again" variant="secondary" onPress={home.reload} />}
        />
      ) : allEmpty ? (
        <EmptyState
          icon={KeyRound}
          title="No rentals yet."
          body="When a customer picks up a car, tap New rental — CarCheck walks you through photos, damage and signature."
        />
      ) : sections ? (
        <>
          {sections.unfinished.length > 0 ? (
            <ListSection title="Unfinished" band flush>
              {sections.unfinished.map((item) => {
                const meta = unfinishedMeta(item);
                return (
                  <ListRow
                    key={item.rental.id}
                    title={rowTitle(item)}
                    subtitle={rowSubtitle(item)}
                    meta={
                      <View style={styles.metaRow}>
                        {meta.progress ? <ProgressTicks done={meta.progress.done} /> : null}
                        <Text variant="bodySmall" tone="secondary" tabular>
                          {meta.text}
                        </Text>
                      </View>
                    }
                    trailing={<Button label="Resume" variant="tonal" size="small" onPress={() => resume(item)} />}
                    onPress={() => openRental(item.rental.id)}
                    onLongPress={item.rental.status === 'draft' ? () => setDiscardTarget(item) : undefined}
                    accessibilityHint={item.rental.status === 'draft' ? 'Long press to discard this draft' : undefined}
                  />
                );
              })}
            </ListSection>
          ) : null}

          {sections.dueBack.length > 0 ? (
            <ListSection title="Due back" count={sections.dueBack.length} flush={sections.unfinished.length === 0}>
              {sections.dueBack.map((item) => {
                const due = dueBackMeta(item, now);
                return (
                  <ListRow
                    key={item.rental.id}
                    title={rowTitle(item)}
                    subtitle={rowSubtitle(item)}
                    meta={
                      <View style={styles.metaRow}>
                        {due.overdue ? <Icon icon={Clock} size={16} /> : null}
                        <Text variant="bodySmall" style={due.overdue ? styles.overdue : undefined} tabular>
                          {due.text}
                        </Text>
                      </View>
                    }
                    trailing={<Button label="Return" variant="secondary" size="small" onPress={() => handleReturn(item.rental.id)} />}
                    onPress={() => openRental(item.rental.id)}
                  />
                );
              })}
            </ListSection>
          ) : null}

          {sections.out.length > 0 ? (
            <ListSection title="Out" count={sections.out.length}>
              {sections.out.map((item) => (
                <ListRow
                  key={item.rental.id}
                  title={rowTitle(item)}
                  subtitle={rowSubtitle(item)}
                  meta={
                    item.rental.expectedReturnAt !== null
                      ? `Due ${formatRelativeDateTime(item.rental.expectedReturnAt, now)}`
                      : 'No return date set'
                  }
                  trailing={<Button label="Return" variant="secondary" size="small" onPress={() => handleReturn(item.rental.id)} />}
                  onPress={() => openRental(item.rental.id)}
                />
              ))}
            </ListSection>
          ) : null}

          {sections.returned.length > 0 || returnedExpanded ? (
            <ListSection
              title="Returned"
              action={
                returnedExpanded ? null : (
                  <Button
                    label="All history"
                    variant="quiet"
                    onPress={expandReturned}
                    loading={returnedExpanding}
                  />
                )
              }
            >
              {(returnedExpanded ?? sections.returned).map((item) => (
                <ListRow
                  key={item.rental.id}
                  title={rowTitle(item)}
                  subtitle={rowSubtitle(item)}
                  meta={returnedStatusLine(item)}
                  onPress={() => openRental(item.rental.id)}
                />
              ))}
            </ListSection>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: layout.screenGutter, paddingTop: 4, paddingBottom: 4 },
  bannerActions: { flexDirection: 'row' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  overdue: { fontFamily: fontFamily.semibold },
});
