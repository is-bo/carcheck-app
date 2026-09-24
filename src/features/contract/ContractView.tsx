/**
 * Native rendering of contract HTML (no WebView): contractHtmlToBlocks() blocks set in the
 * employee scale (review) or the customer hand-off scale (about 1.25x, never capped). Damage
 * photos carry their lettered rings; the signature slot shows where the customer will sign, or
 * the signature itself once it exists.
 */
import { Image } from 'expo-image';
import { Fragment, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { photoPath } from '@/data/files';
import type { ContractDamageItem } from '@/domain/contract';
import type { Id } from '@/domain/types';
import { contractHtmlToBlocks, type ContractBlock, type ContractImageSource, type TextSpan } from '@/documents';
import { Text, type TextVariant } from '@/ui';
import { layout, lines, markerGeometry, palette, radii } from '@/ui/theme/tokens';

import { MarkedPhoto } from '../damage/MarkedPhoto';

export type ContractAudience = 'employee' | 'customer';

export interface ContractViewProps {
  html: string;
  rentalId: Id;
  /**
   * Pick-up damage as rendered in the contract: names the photos' angles and draws their rings
   * when the HTML carries none (the frozen SVG rings take precedence).
   */
  damage: readonly ContractDamageItem[];
  audience: ContractAudience;
  /** Signature PNG once signed; otherwise the slot shows the signing line. */
  signatureUri?: string | null;
}

const VARIANTS: Record<ContractAudience, { h1: TextVariant; h2: TextVariant; h3: TextVariant; body: TextVariant; bodyStrong: TextVariant }> = {
  employee: { h1: 'titleL', h2: 'titleM', h3: 'titleS', body: 'body', bodyStrong: 'bodyStrong' },
  customer: {
    h1: 'customer.headline',
    h2: 'customer.section',
    h3: 'customer.bodyStrong',
    body: 'customer.body',
    bodyStrong: 'customer.bodyStrong',
  },
};

function Spans({ spans, variant, strong }: { spans: TextSpan[]; variant: TextVariant; strong: TextVariant }) {
  return (
    <Text variant={variant}>
      {spans.map((s, i) =>
        s.bold ? (
          <Text key={i} variant={strong}>
            {s.text}
          </Text>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </Text>
  );
}

export function ContractView({ html, rentalId, damage, audience, signatureUri }: ContractViewProps) {
  const blocks = useMemo(() => contractHtmlToBlocks(html), [html]);
  const v = VARIANTS[audience];
  const customer = audience === 'customer';
  const badge = customer ? markerGeometry.badgeSizeCustomer : markerGeometry.badgeSize;

  const photoBlock = (source: Extract<ContractImageSource, { kind: 'photo' }>, key: string, alt?: string) => {
    const { photoId, annotated } = source;
    const items = damage.filter((d) => d.photoId === photoId);
    // The rings frozen in the HTML win: a signed contract shows what the customer signed.
    const frozen = source.marks ?? null;
    const marks = !annotated
      ? []
      : frozen
        ? frozen.map((m) => ({ key: m.label, status: 'pre_existing' as const, label: m.label, ring: m.ring }))
        : items.map((d) => ({ key: d.label, status: 'pre_existing' as const, label: d.label, ring: d.ring }));
    const size =
      source.size ?? (items[0] ? { width: items[0].photoWidth, height: items[0].photoHeight } : { width: 4, height: 3 });
    const labels = marks.map((m) => m.label);
    return (
      <MarkedPhoto
        key={key}
        photo={{ id: photoId, rentalId, file: { path: photoPath(rentalId, photoId) } }}
        size={size}
        marks={marks}
        badgeSize={badge}
        accessibilityLabel={`${items[0]?.angleLabel ?? (alt || 'Photo')}${labels.length ? `, marks ${labels.join(', ')}` : ''}`}
        style={styles.photo}
      />
    );
  };

  const render = (b: ContractBlock, i: number) => {
    switch (b.type) {
      case 'heading': {
        const variant = b.level === 1 ? v.h1 : b.level === 2 ? v.h2 : v.h3;
        return (
          <View key={i} style={[b.level === 1 ? styles.h1 : styles.h2, b.level === 2 && styles.rule]} accessibilityRole="header">
            <Spans spans={b.spans} variant={variant} strong={variant} />
          </View>
        );
      }
      case 'paragraph':
        return (
          <View key={i} style={styles.block}>
            <Spans spans={b.spans} variant={v.body} strong={v.bodyStrong} />
          </View>
        );
      case 'list':
        return (
          <View key={i} style={styles.list}>
            {b.items.map((item, j) => (
              <View key={j} style={[styles.item, { paddingLeft: item.depth * 16 }]}>
                <Text variant={v.body} tabular style={styles.bullet}>
                  {b.ordered ? `${j + 1}.` : '•'}
                </Text>
                <View style={styles.itemBody}>
                  {item.spans.length ? <Spans spans={item.spans} variant={v.body} strong={v.bodyStrong} /> : null}
                  {item.images.map((img, k) =>
                    img.kind === 'photo' ? photoBlock(img, `${j}-${k}`) : null,
                  )}
                </View>
              </View>
            ))}
          </View>
        );
      case 'image':
        return b.source.kind === 'photo' ? (
          photoBlock(b.source, String(i), b.alt)
        ) : (
          <Image key={i} source={{ uri: b.source.uri }} style={styles.dataImage} contentFit="contain" accessibilityLabel={b.alt} />
        );
      case 'signature':
        return (
          <View key={i} style={styles.signature} accessibilityLabel={signatureUri ? 'Customer signature' : 'Signature line'}>
            {signatureUri ? (
              <Image source={{ uri: signatureUri }} style={styles.signatureImage} contentFit="contain" />
            ) : (
              <Text variant={customer ? 'customer.fine' : 'bodySmall'} tone="secondary" style={styles.signaturePrompt}>
                {customer ? 'You sign on the next screen.' : 'The customer signs here on the next screen.'}
              </Text>
            )}
            <View style={styles.baseline} />
          </View>
        );
      case 'rule':
        return <View key={i} style={styles.hr} />;
    }
  };

  return <View style={customer ? styles.customer : styles.employee}>{blocks.map(render)}</View>;
}

const styles = StyleSheet.create({
  employee: { paddingHorizontal: layout.screenGutter },
  customer: { paddingHorizontal: layout.customerGutter },
  h1: { marginTop: 8, marginBottom: 4 },
  h2: { marginTop: 24, paddingBottom: 8, marginBottom: 4 },
  rule: { borderBottomWidth: lines.sectionRule, borderBottomColor: palette.ink },
  block: { marginTop: 10 },
  list: { marginTop: 10, gap: 6 },
  item: { flexDirection: 'row', gap: 8 },
  bullet: { minWidth: 16 },
  itemBody: { flex: 1, gap: 8 },
  photo: { marginTop: 12, maxWidth: 560 },
  dataImage: { marginTop: 12, width: '100%', aspectRatio: 4 / 3 },
  signature: { marginTop: 16, height: 96, justifyContent: 'flex-end', borderRadius: radii.md, backgroundColor: palette.paper2, padding: 12 },
  signaturePrompt: { position: 'absolute', top: 12, left: 12, right: 12 },
  signatureImage: { position: 'absolute', top: 8, left: 12, right: 12, bottom: 20 },
  baseline: { height: lines.control, backgroundColor: palette.ink },
  hr: { marginTop: 16, height: lines.divider, backgroundColor: palette.rule },
});
