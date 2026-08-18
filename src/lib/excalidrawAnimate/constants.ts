export const SVG_EXPORT_PADDING = 30;
export const ANIMATION_META_KEY = "__arthasAnimationMeta__";

export type AnimationTimelineEntry = {
    order?: number;
    duration?: number;
    groupId?: string | null;
};

export type AnimationTimelineMap = Record<string, AnimationTimelineEntry>;
