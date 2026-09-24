import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, ListChecks, Lock, RotateCcw } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { DataError, getPhoto, getRentalFacts } from '@/data/repos';
import { isAfterEditable, isBeforeEditable, type RentalFacts } from '@/domain/rentalLifecycle';
import { EXTERIOR_ANGLE_KEYS, type Photo } from '@/domain/types';
import { damageRowDetail, damageRowTitle } from '@/features/damage/damageForm';
import { DamageSheet } from '@/features/damage/DamageSheet';
import { useDamageMarking, type DamageMarking } from '@/features/damage/useDamageMarking';
import { saveCapturedPhoto } from '@/features/inspection/captureService';
import { usePhotoUri } from '@/features/inspection/photoFiles';
import { SingleShotCamera } from '@/features/inspection/SingleShotCamera';
import { useLiveQuery } from '@/features/inspection/useLiveQuery';
import { MarkerEditor } from '@/media/annotate';
import {
  BottomSheet,
  Button,
  EmptyState,
  exteriorAngleLabels,
  formatEdgeTimestamp,
  Icon,
  IconButton,
  ListRow,
  ListSection,
  MarkerBadge,
  plural,
  Screen,
  showToast,
  Text,
  type ExteriorAngleKey,
} from '@/ui';
import { layout, rebate } from '@/ui/theme/tokens';

const LOCK_COPY = {
  before:
    'Pick-up damage is part of the signed contract. Void & re-sign to change it, or mark it as Uncertain at return.',
  after: 'The return is completed. Use Edit return to change it.',
} as const;

function editableFor(photo: Photo, facts: RentalFacts): boolean {
  return photo.phase === 'before' ? isBeforeEditable(facts.status, facts.hasValidContract) : isAfterEditable(facts.status, facts.returnReopenedAt);
}

function angleName(photo: Photo): string {
  if (photo.label) return photo.label;
  if ((EXTERIOR_ANGLE_KEYS as readonly string[]).includes(photo.angleKey)) return exteriorAngleLabels[photo.angleKey as ExteriorAngleKey];
  const base = photo.angleKey.charAt(0).toUpperCase() + photo.angleKey.slice(1).replace(/_/g, ' ');
  return photo.slot > 1 ? `${base} ${photo.slot}` : base;
}

/**
 * Marker editor on one photo (UX §4, mockup c-mark): BEFORE photos at pick-up and extra shots.
 * Tap drops a pin and opens the quick sheet; drag the badge to move, the ring edge to resize.
 */
export default function AnnotateRoute() {
  const params = useLocalSearchParams<{ id: string; photoId: string }>();
  const rentalId = params.id;
  const [photoId, setPhotoId] = useState(params.photoId);
  const photo = useLiveQuery(() => getPhoto(photoId), [photoId], ['photo']);
  const facts = useLiveQuery(() => getRentalFacts(rentalId), [rentalId], ['rental', 'contract']);
  const editable = !!photo.data && !!facts.data && editableFor(photo.data, facts.data);
  const marking = useDamageMarking({ rentalId, photo: photo.data ?? null, editable });

  if (photo.error && !photo.data) {
    return (
      <Screen tone="rebate" leading="back" title="Photo">
        <EmptyState
          icon={CircleAlert}
          title="This photo is no longer here."
          body="It may have been retaken. Go back to see the current photos."
          action={<Button label="Go back" onPress={() => router.back()} />}
        />
      </Screen>
    );
  }
  if (!photo.data) return <Screen tone="rebate" leading="back" title="Photo" />;
  return <Editor photo={photo.data} rentalId={rentalId} editable={editable} marking={marking} onReplaced={setPhotoId} />;
}

function Editor({
  photo,
  rentalId,
  editable,
  marking,
  onReplaced,
}: {
  photo: Photo;
  rentalId: string;
  editable: boolean;
  marking: DamageMarking;
  onReplaced: (photoId: string) => void;
}) {
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const uri = usePhotoUri(photo, 'display');
  const [listOpen, setListOpen] = useState(false);
  const [camera, setCamera] = useState<'closeup' | 'retake' | null>(null);
  const closeupUri = usePhotoUri(marking.selectedCloseup, 'thumb');

  const name = angleName(photo);
  const phaseWord = photo.phase === 'before' ? 'Pick-up' : 'Return';
  const index = EXTERIOR_ANGLE_KEYS.indexOf(photo.angleKey as ExteriorAngleKey);
  const edgeCode = [name, index >= 0 ? `${index + 1}/8` : null, phaseWord, formatEdgeTimestamp(photo.capturedAt)].filter(Boolean).join(' · ');
  const canRetake = editable && photo.kind === 'angle' && photo.frozenAt === null;
  const selectedLabel = marking.selectedLabel;

  const onShot = (tempUri: string, meta: { capturedAt: number; tzOffsetMin: number }) => {
    if (camera === 'closeup') {
      const damageId = marking.selectedId;
      if (!damageId) return;
      saveCapturedPhoto({
        rentalId,
        phase: photo.phase,
        angleKey: photo.angleKey,
        slot: photo.slot,
        kind: 'damage_closeup',
        tempUri,
        meta,
      })
        .then((closeup) => marking.attachCloseup(damageId, closeup.id))
        .then(
          () => showToast('Close-up added'),
          (e: unknown) => showToast(e instanceof DataError ? e.message : 'Couldn’t save the close-up. Try again.'),
        );
    } else if (camera === 'retake') {
      const hadMarks = marking.damages.length > 0;
      saveCapturedPhoto({ rentalId, phase: photo.phase, angleKey: photo.angleKey, slot: photo.slot, tempUri, meta }).then(
        (next) => {
          onReplaced(next.id);
          router.setParams({ photoId: next.id });
          showToast(hadMarks ? 'Photo retaken. Check the marks still sit on the damage.' : 'Photo retaken');
        },
        (e: unknown) => showToast(e instanceof DataError ? e.message : 'Couldn’t save the new photo. Try again.'),
      );
    }
  };

  const markList = (
    <ListSection>
      {marking.damages.map((d) => {
        const label = marking.markers.find((m) => m.damageId === d.id)?.label ?? '';
        return (
          <ListRow
            key={d.id}
            leading={<MarkerBadge status={d.status} label={label} size={26} accessible={false} />}
            title={damageRowTitle(d)}
            subtitle={damageRowDetail(d) ?? undefined}
            onPress={() => {
              setListOpen(false);
              marking.select(d.id);
            }}
          />
        );
      })}
    </ListSection>
  );

  return (
    <Screen
      tone="rebate"
      column={false}
      leading="back"
      title={`${name} · ${phaseWord}`}
      subtitle={editable ? 'Tap the photo to mark damage' : 'Read-only'}
      insets={{ bottom: !landscape }}
      actions={
        <>
          {landscape ? (
            <IconButton icon={ListChecks} accessibilityLabel="List of marks" onPress={() => setListOpen(true)} />
          ) : null}
          {canRetake ? <IconButton icon={RotateCcw} accessibilityLabel="Retake photo" onPress={() => setCamera('retake')} /> : null}
        </>
      }
      overlay={
        <>
          <DamageSheet
            visible={!!marking.selected}
            mode={marking.mode}
            initial={marking.selected ?? undefined}
            badgeLabel={selectedLabel}
            onSave={marking.save}
            onDelete={editable ? marking.remove : undefined}
            onAddCloseup={editable ? () => setCamera('closeup') : undefined}
            onClose={() => marking.select(null)}
            closeupUri={closeupUri}
            readOnly={!editable}
            readOnlyReason={LOCK_COPY[photo.phase]}
          />
          <BottomSheet
            open={listOpen}
            onClose={() => setListOpen(false)}
            snapPoints={['70%']}
            accessibilityLabel="Marks on this photo"
            header={<Text variant="titleL">{plural(marking.damages.length, '{n} mark', '{n} marks')}</Text>}
          >
            <ScrollView>{markList}</ScrollView>
          </BottomSheet>
          <SingleShotCamera
            visible={!!camera}
            title={camera === 'retake' ? `${name.toUpperCase()} · Retake` : `CLOSE-UP · Damage ${selectedLabel ?? ''}`}
            instruction={camera === 'retake' ? 'Frame it like the first photo. The marks move to the new photo.' : 'Get close enough to show the damage clearly.'}
            preferredOrientation={camera === 'retake' && photo.file.width > photo.file.height ? 'landscape' : undefined}
            onCaptured={onShot}
            onClose={() => setCamera(null)}
          />
        </>
      }
    >
      <View style={landscape ? styles.fill : styles.portrait}>
        <View style={landscape ? styles.fill : { aspectRatio: Math.max(photo.file.width / photo.file.height, 0.75) }}>
          {uri ? (
            <MarkerEditor
              photo={{ uri, size: { width: photo.file.width, height: photo.file.height } }}
              markers={marking.markers}
              selectedId={marking.selectedId}
              editable={editable}
              onDrop={marking.drop}
              onSelect={marking.select}
              onChange={marking.change}
              onImageError={() => showToast('Couldn’t open this photo.')}
            />
          ) : null}
        </View>
        {!landscape ? (
          <ScrollView style={styles.fill} contentContainerStyle={styles.below}>
            <View style={styles.edge}>
              <Text variant="code" tone="secondary" numberOfLines={1} style={styles.fill}>
                {edgeCode}
              </Text>
              <Text variant="code" tone="secondary" tabular>
                {plural(marking.damages.length, '{n} mark', '{n} marks')}
              </Text>
            </View>
            {!editable ? (
              <View style={styles.locked}>
                <Icon icon={Lock} size={20} color={rebate.textSecondary} />
                <Text variant="bodySmall" tone="secondary" style={styles.fill}>
                  {LOCK_COPY[photo.phase]}
                </Text>
              </View>
            ) : null}
            {marking.damages.length > 0 ? (
              markList
            ) : editable ? (
              <Text variant="body" tone="secondary" style={styles.empty}>
                No marks. Tap the damage on the photo, or go back if there is none.
              </Text>
            ) : null}
          </ScrollView>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  portrait: { flex: 1 },
  below: { paddingBottom: 24 },
  edge: { flexDirection: 'row', gap: 12, paddingHorizontal: layout.screenGutter, paddingTop: 8, paddingBottom: 4 },
  locked: { flexDirection: 'row', gap: 10, paddingHorizontal: layout.screenGutter, paddingVertical: 12 },
  empty: { paddingHorizontal: layout.screenGutter, paddingTop: 16 },
});
