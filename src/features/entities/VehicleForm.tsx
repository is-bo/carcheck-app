/**
 * Create/edit vehicle body (BRIEF: only the plate is required; year, VIN, colour, mileage,
 * photo and notes are optional). Shared by app/vehicle/new.tsx and app/vehicle/[id]/edit.tsx so
 * the two routes stay thin wrappers around one form.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Camera, ImagePlus, X } from 'lucide-react-native';

import { resolveFileUri } from '@/data/files';
import { createVehicle, getAgencySettings, setVehiclePhoto, updateVehicle, ValidationError, type VehicleInput } from '@/data/repos';
import type { CapturedImage, Vehicle } from '@/domain/types';
import {
  Button,
  Icon,
  KeyboardAwareForm,
  Screen,
  Text,
  TextField,
  showToast,
} from '@/ui';
import { palette, radii } from '@/ui/theme/tokens';

import { capturedImageFromLibrary } from './media';
import { PhotoCaptureModal } from './PhotoCaptureModal';
import { useLiveQuery } from './useLiveQuery';

export interface VehicleFormProps {
  mode: 'create' | 'edit';
  vehicle?: Vehicle;
  onSaved: (vehicle: Vehicle) => void;
  onCancel: () => void;
}

const SETTINGS_WATCH = ['settings'] as const;

export function VehicleForm({ mode, vehicle, onSaved, onCancel }: VehicleFormProps) {
  const agency = useLiveQuery(getAgencySettings, SETTINGS_WATCH);
  const [plate, setPlate] = useState(vehicle?.plate ?? '');
  const [plateError, setPlateError] = useState<string | null>(null);
  const [make, setMake] = useState(vehicle?.make ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [vin, setVin] = useState(vehicle?.vin ?? '');
  const [mileage, setMileage] = useState(vehicle?.mileage != null ? String(vehicle.mileage) : '');
  const [notes, setNotes] = useState(vehicle?.notes ?? '');

  const [pendingPhoto, setPendingPhoto] = useState<CapturedImage | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const photoUri = pendingPhoto ? pendingPhoto.tempUri : !photoRemoved && vehicle?.photo ? resolveFileUri(vehicle.photo.path) : null;
  const hasPhoto = !!photoUri;

  async function pickFromLibrary() {
    try {
      const image = await capturedImageFromLibrary('vehicle');
      if (image) {
        setPendingPhoto(image);
        setPhotoRemoved(false);
      }
    } catch {
      showToast("Couldn't open the photo library.");
    }
  }

  async function handleSubmit() {
    const cleanPlate = plate.trim();
    if (!cleanPlate) {
      setPlateError('Enter the plate.');
      return;
    }
    setSubmitting(true);
    const input: VehicleInput = {
      plate: cleanPlate,
      make: make.trim() || null,
      model: model.trim() || null,
      year: year.trim() ? Number(year.trim()) : null,
      color: color.trim() || null,
      vin: vin.trim() || null,
      mileage: mileage.trim() ? Number(mileage.trim()) : null,
      notes: notes.trim() || null,
    };
    try {
      const saved = mode === 'edit' && vehicle ? await updateVehicle(vehicle.id, input) : await createVehicle(input);
      const final = photoRemoved ? await setVehiclePhoto(saved.id, null) : pendingPhoto ? await setVehiclePhoto(saved.id, pendingPhoto) : saved;
      onSaved(final);
    } catch (e) {
      if (e instanceof ValidationError && e.field === 'plate') setPlateError(e.message);
      else showToast(e instanceof Error ? e.message : "Couldn't save the vehicle.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen
      title={mode === 'edit' ? 'Edit vehicle' : 'New vehicle'}
      leading={mode === 'edit' ? 'back' : 'close'}
      onLeadingPress={onCancel}
      insets={{ bottom: false }}
    >
      <KeyboardAwareForm
        footer={
          <Button
            label={mode === 'edit' ? 'Save changes' : 'Add vehicle'}
            onPress={handleSubmit}
            loading={submitting}
            fullWidth
          />
        }
      >
        <TextField
          label="Plate"
          variant="plate"
          value={plate}
          onChangeText={(v) => {
            setPlate(v);
            if (plateError) setPlateError(null);
          }}
          error={plateError}
          hint={plateError ? undefined : 'As printed on the car'}
        />
        <TextField label="Make" value={make} onChangeText={setMake} placeholder="Renault" />
        <TextField label="Model" value={model} onChangeText={setModel} placeholder="Clio" />
        <View style={styles.row}>
          <View style={styles.half}>
            <TextField label="Year" optional variant="numeric" value={year} onChangeText={setYear} />
          </View>
          <View style={styles.half}>
            <TextField label="Colour" optional value={color} onChangeText={setColor} />
          </View>
        </View>
        <TextField label="VIN" optional value={vin} onChangeText={setVin} autoCapitalize="characters" />
        <TextField
          label="Mileage"
          optional
          variant="mileage"
          unit={agency.data?.distanceUnit ?? 'km'}
          value={mileage}
          onChangeText={setMileage}
        />

        <View>
          <Text variant="label" style={styles.fieldLabel}>
            Photo{' '}
            <Text variant="label" tone="tertiary">
              (optional)
            </Text>
          </Text>
          <View style={styles.photoRow}>
            {hasPhoto ? (
              <Image source={{ uri: photoUri }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Icon icon={ImagePlus} color={palette.ink3} />
              </View>
            )}
            <View style={styles.photoActions}>
              <Button label="Take photo" variant="secondary" size="small" icon={Camera} onPress={() => setCameraOpen(true)} />
              <Button label="Choose from library" variant="secondary" size="small" icon={ImagePlus} onPress={pickFromLibrary} />
              {hasPhoto ? (
                <Button
                  label="Remove photo"
                  variant="destructive"
                  size="small"
                  icon={X}
                  onPress={() => {
                    setPendingPhoto(null);
                    setPhotoRemoved(true);
                  }}
                />
              ) : null}
            </View>
          </View>
        </View>

        <TextField label="Notes" optional multiline value={notes} onChangeText={setNotes} placeholder="Anything worth knowing about this car" />
      </KeyboardAwareForm>

      <PhotoCaptureModal
        visible={cameraOpen}
        title="Vehicle photo"
        onClose={() => setCameraOpen(false)}
        onCaptured={(image) => {
          setPendingPhoto(image);
          setPhotoRemoved(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  fieldLabel: { marginBottom: 8 },
  photoRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  photo: { width: 96, height: 72, borderRadius: radii.photo, backgroundColor: palette.paper2 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  photoActions: { flex: 1, gap: 8, alignItems: 'flex-start' },
});
