/**
 * Live "Preview" pane of the contract template editor (UX_FLOWS §7): renders the template with
 * realistic sample data through the same native pipeline a frozen contract would use
 * (contractHtmlToBlocks), so what the employee sees here is honest about how it will look on
 * screen. Sample photos and the signature have no real file, so they render as labelled
 * placeholders rather than broken images.
 */
import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Image as ImageIcon, PenLine, TriangleAlert } from 'lucide-react-native';

import { renderContractTemplate, sampleRentalContext } from '@/domain/contract';
import { contractHtmlToBlocks, type ContractBlock, type ContractImageSource, type TextSpan } from '@/documents';
import { Banner, Icon, Text, useSurface, type TextVariant } from '@/ui';
import { fontFamily, layout, lines, radii, space } from '@/ui/theme/tokens';

export interface ContractPreviewProps {
  body: string;
}

const SAMPLE_CONTEXT = sampleRentalContext();

export function ContractPreview({ body }: ContractPreviewProps) {
  const { blocks, unknownKeys } = useMemo(() => {
    const rendered = renderContractTemplate(body, SAMPLE_CONTEXT);
    return { blocks: contractHtmlToBlocks(rendered.html), unknownKeys: rendered.unknownKeys };
  }, [body]);

  return (
    <View style={styles.wrap}>
      {unknownKeys.length > 0 ? (
        <Banner
          icon={TriangleAlert}
          message={`Unknown field${unknownKeys.length > 1 ? 's' : ''}: ${unknownKeys.map((k) => `{{${k}}}`).join(', ')}`}
        />
      ) : null}
      <View style={styles.body}>
        {blocks.length === 0 ? (
          <Text variant="body" tone="tertiary" style={styles.empty}>
            Nothing to preview yet.
          </Text>
        ) : (
          blocks.map((block, i) => <Block key={i} block={block} />)
        )}
      </View>
    </View>
  );
}

function Block({ block }: { block: ContractBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <Spans
          spans={block.spans}
          variant={block.level === 1 ? 'titleL' : block.level === 2 ? 'titleM' : 'label'}
          style={styles.heading}
        />
      );
    case 'paragraph':
      return <Spans spans={block.spans} style={styles.paragraph} />;
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            <View key={i} style={[styles.listItem, { paddingLeft: item.depth * space[5] }]}>
              <Text variant="body" tone="secondary" style={styles.bullet}>
                {block.ordered ? `${i + 1}.` : '•'}
              </Text>
              <View style={styles.listItemBody}>
                <Spans spans={item.spans} />
                {item.images.map((src, k) => (
                  <ImagePlaceholder key={k} source={src} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case 'image':
      return <ImagePlaceholder source={block.source} alt={block.alt} style={styles.paragraph} />;
    case 'signature':
      return <SignaturePlaceholder />;
    case 'rule':
      return <Rule />;
  }
}

function Spans({
  spans,
  variant = 'body',
  style,
}: {
  spans: TextSpan[];
  variant?: TextVariant;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text variant={variant} style={style}>
      {spans.map((span, i) => (
        <Text key={i} variant={variant} style={span.bold ? styles.bold : undefined}>
          {span.text}
        </Text>
      ))}
    </Text>
  );
}

function ImagePlaceholder({
  source,
  alt,
  style,
}: {
  source: ContractImageSource;
  alt?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useSurface();
  const caption = source.kind === 'photo' ? (alt?.trim() ? alt : 'Sample photo') : (alt ?? 'Photo');
  return (
    <View style={style}>
      <View style={[styles.photo, { backgroundColor: colors.surfaceTint, borderColor: colors.outline }]}>
        <Icon icon={ImageIcon} size={28} color={colors.textTertiary} />
      </View>
      <Text variant="caption" tone="tertiary" style={styles.photoCaption}>
        {caption} (preview only)
      </Text>
    </View>
  );
}

function SignaturePlaceholder() {
  const { colors } = useSurface();
  return (
    <View style={styles.paragraph}>
      <View style={[styles.signature, { backgroundColor: colors.surfaceTint, borderColor: colors.outline }]}>
        <Icon icon={PenLine} size={20} color={colors.textTertiary} />
        <Text variant="bodySmall" tone="tertiary" style={styles.signatureLabel}>
          Customer’s signature appears here
        </Text>
      </View>
    </View>
  );
}

function Rule() {
  const { colors } = useSurface();
  return <View style={[styles.rule, { backgroundColor: colors.divider }]} />;
}

const styles = StyleSheet.create({
  wrap: { gap: space[4] },
  body: { paddingHorizontal: layout.screenGutter, gap: space[4], paddingBottom: space[8] },
  empty: { paddingTop: space[6] },
  heading: { marginTop: space[3] },
  paragraph: {},
  bold: { fontFamily: fontFamily.semibold },
  list: { gap: space[3] },
  listItem: { flexDirection: 'row', gap: space[3] },
  bullet: { width: 18 },
  listItemBody: { flex: 1, minWidth: 0, gap: space[3] },
  photo: {
    aspectRatio: 4 / 3,
    borderRadius: radii.photo,
    borderWidth: lines.control,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 320,
  },
  photoCaption: { marginTop: space[2] },
  signature: {
    height: 96,
    borderRadius: radii.md,
    borderWidth: lines.control,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  signatureLabel: {},
  rule: { height: lines.divider, marginVertical: space[2] },
});
