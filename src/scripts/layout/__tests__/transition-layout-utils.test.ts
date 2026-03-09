import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    BANNER_TO_SPEC_TRANSITION_DURATION_MS,
    BANNER_TO_SPEC_VT_DURATION_VAR,
    applyBannerWaveAnimationSnapshot,
    applyVtDurationFromElapsed,
    bridgeCurrentBannerToIncomingDocument,
    captureBannerWaveAnimationSnapshot,
    getBannerToSpecRemainingMs,
    primeBannerWaveAnimationSnapshot,
    primeBannerLayoutStateForIncomingDocument,
    resolveBannerToSpecShiftMetricsFromViewportPositions,
    resolveMainPanelShiftFromViewportPositions,
    shouldStartBannerToSpecTransition,
    type TransitionState,
} from "../transition-layout-utils";

type StyleStore = {
    getPropertyValue: (name: string) => string;
    setProperty: (name: string, value: string) => void;
};

function createStyleStore(): StyleStore {
    const values = new Map<string, string>();
    return {
        getPropertyValue: (name) => values.get(name) ?? "",
        setProperty: (name, value) => {
            values.set(name, value);
        },
    };
}

function createTransitionState(): TransitionState {
    return {
        pendingBannerToSpecRoutePath: "/posts",
        pendingSidebarProfilePatch: null,
        pendingBannerWaveAnimationSnapshot: null,
        bannerToSpecAnimationStartedAt: 100,
        viewTransitionFinished: null,
        delayedPageViewTimerId: null,
        didReplaceContentDuringVisit: true,
        didForceNavbarScrolledForBannerToSpec: false,
        pendingSpecToBannerFreeze: false,
        navigationInProgress: true,
        navigationToken: 1,
        lastFinalizedNavigationToken: null,
    };
}

function createClassList() {
    const values = new Set<string>();
    return {
        add: (...tokens: string[]) => {
            tokens.forEach((token) => values.add(token));
        },
        remove: (...tokens: string[]) => {
            tokens.forEach((token) => values.delete(token));
        },
        contains: (token: string) => values.has(token),
    };
}

type MockAnimation = {
    currentTime: number | null;
    effect?: {
        getTiming: () => {
            duration: number;
        };
    };
};

type MockAnimatedWaveUse = {
    style: {
        animationDelay: string;
        animationDuration: string;
        animationPlayState: string;
    };
    getAnimations: () => MockAnimation[];
};

function createMockAnimatedWaveUse(
    currentTime: number,
    durationMs = 7000,
): MockAnimatedWaveUse {
    const animation: MockAnimation = {
        currentTime,
        effect: {
            getTiming: () => ({
                duration: durationMs,
            }),
        },
    };
    return {
        style: {
            animationDelay: "",
            animationDuration: "",
            animationPlayState: "",
        },
        getAnimations: () => [animation],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("transition layout timing helpers", () => {
    const rootStyle = createStyleStore();

    beforeEach(() => {
        vi.stubGlobal("document", {
            documentElement: {
                style: rootStyle,
            },
        });
    });

    it("getBannerToSpecRemainingMs 会基于统一的 980ms 宏观时长计算剩余时间", () => {
        const state = createTransitionState();
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(240);

        expect(getBannerToSpecRemainingMs(state)).toBe(
            BANNER_TO_SPEC_TRANSITION_DURATION_MS - 140,
        );

        nowSpy.mockRestore();
    });

    it("applyVtDurationFromElapsed 会将剩余时长同步到当前与传入文档", () => {
        const state = createTransitionState();
        const incomingDocument = {
            documentElement: {
                style: createStyleStore(),
            },
        } as Document;
        const nowSpy = vi.spyOn(performance, "now").mockReturnValue(460);

        applyVtDurationFromElapsed(state, incomingDocument);

        expect(rootStyle.getPropertyValue(BANNER_TO_SPEC_VT_DURATION_VAR)).toBe(
            "620ms",
        );
        expect(
            incomingDocument.documentElement.style.getPropertyValue(
                BANNER_TO_SPEC_VT_DURATION_VAR,
            ),
        ).toBe("620ms");

        nowSpy.mockRestore();
    });

    it("resolveMainPanelShiftFromViewportPositions 会基于当前 viewport 几何计算主内容上滑距离", () => {
        const shiftFromHigherViewportTop =
            resolveMainPanelShiftFromViewportPositions({
                mainPanelTop: 260,
                targetTop: 88,
                sidebarTops: [240, 252],
            });
        const shiftFromLowerViewportTop =
            resolveMainPanelShiftFromViewportPositions({
                mainPanelTop: 420,
                targetTop: 88,
                sidebarTops: [400, 412],
            });

        expect(shiftFromHigherViewportTop).toBeLessThan(
            shiftFromLowerViewportTop,
        );
        expect(shiftFromHigherViewportTop).toBe(152.75);
        expect(shiftFromLowerViewportTop).toBe(312.75);
    });

    it("resolveBannerToSpecShiftMetricsFromViewportPositions 会同时产出内容位移与背景封顶位移", () => {
        const metrics = resolveBannerToSpecShiftMetricsFromViewportPositions({
            mainPanelTop: 420,
            targetTop: 88,
            sidebarTops: [400, 412],
        });

        expect(metrics.mainPanelShiftPx).toBe(312.75);
        expect(metrics.backgroundOvershootPx).toBe(88);
    });
});

describe("transition layout DOM helpers", () => {
    it("primeBannerLayoutStateForIncomingDocument 会把 incoming body 伪装成首页起始布局态，并恢复 banner 可见性", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const body = Object.assign(new MockHtmlElement(), {
            dataset: {
                layoutMode: "none",
                routeHome: "false",
            },
            classList: createClassList(),
        });
        const bannerWrapper = Object.assign(new MockHtmlElement(), {
            classList: createClassList(),
            removeAttribute: vi.fn(),
        });
        bannerWrapper.classList.add("wallpaper-layer-hidden");

        const incomingDocument = {
            body,
            getElementById: (id: string) =>
                id === "banner-wrapper" ? bannerWrapper : null,
        } as unknown as Document;

        primeBannerLayoutStateForIncomingDocument(incomingDocument);

        expect(body.dataset.layoutMode).toBe("banner");
        expect(body.dataset.routeHome).toBe("true");
        expect(body.classList.contains("lg:is-home")).toBe(true);
        expect(body.classList.contains("enable-banner")).toBe(true);
        expect(body.classList.contains("no-banner-mode")).toBe(false);
        expect(body.classList.contains("waves-paused")).toBe(false);
        expect(bannerWrapper.classList.contains("wallpaper-layer-hidden")).toBe(
            false,
        );
        expect(bannerWrapper.removeAttribute).toHaveBeenCalledWith(
            "aria-hidden",
        );
        expect(bannerWrapper.removeAttribute).toHaveBeenCalledWith("inert");
    });

    it("bridgeCurrentBannerToIncomingDocument 会在 swap 前把当前 banner 克隆进 incoming 文档", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const bridgedBanner = Object.assign(new MockHtmlElement(), {
            marker: "bridged",
        });
        const currentBanner = Object.assign(new MockHtmlElement(), {
            cloneNode: vi.fn(() => bridgedBanner),
        });
        const incomingBanner = Object.assign(new MockHtmlElement(), {
            replaceWith: vi.fn(),
        });
        const currentDocument = {
            getElementById: (id: string) =>
                id === "banner-wrapper" ? currentBanner : null,
        } as unknown as Document;
        const incomingDocument = {
            getElementById: (id: string) =>
                id === "banner-wrapper" ? incomingBanner : null,
        } as unknown as Document;

        const didBridge = bridgeCurrentBannerToIncomingDocument(
            incomingDocument,
            currentDocument,
        );

        expect(didBridge).toBe(true);
        expect(currentBanner.cloneNode).toHaveBeenCalledWith(true);
        expect(incomingBanner.replaceWith).toHaveBeenCalledTimes(1);
        expect(incomingBanner.replaceWith.mock.calls[0]?.[0]).toBe(
            bridgedBanner,
        );
        expect(incomingBanner.replaceWith.mock.calls[0]?.[0]).not.toBe(
            currentBanner,
        );
    });

    it("bridgeCurrentBannerToIncomingDocument 在缺少当前或 incoming banner 时会直接跳过", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const currentDocument = {
            getElementById: () => null,
        } as unknown as Document;
        const incomingDocument = {
            getElementById: () => null,
        } as unknown as Document;

        expect(
            bridgeCurrentBannerToIncomingDocument(
                incomingDocument,
                currentDocument,
            ),
        ).toBe(false);
    });

    it("shouldStartBannerToSpecTransition 仅在首页真实仍处于 banner 布局态时启用宏观过渡", () => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);

        const body = Object.assign(new MockHtmlElement(), {
            dataset: {
                layoutMode: "banner",
            },
        }) as unknown as HTMLElement;
        const bannerWrapper = Object.assign(new MockHtmlElement(), {
            classList: createClassList(),
        }) as unknown as HTMLElement;

        expect(
            shouldStartBannerToSpecTransition({
                currentIsHome: true,
                isTargetHome: false,
                body,
                bannerWrapper,
            }),
        ).toBe(true);

        body.dataset.layoutMode = "collapsed";
        expect(
            shouldStartBannerToSpecTransition({
                currentIsHome: true,
                isTargetHome: false,
                body,
                bannerWrapper,
            }),
        ).toBe(false);

        body.dataset.layoutMode = "banner";
        bannerWrapper.classList.add("wallpaper-layer-hidden");
        expect(
            shouldStartBannerToSpecTransition({
                currentIsHome: true,
                isTargetHome: false,
                body,
                bannerWrapper,
            }),
        ).toBe(false);
    });
});

describe("banner wave animation snapshot helpers", () => {
    it("captureBannerWaveAnimationSnapshot 会记录当前首页波浪动画进度", () => {
        const sourceDocument = {
            querySelectorAll: (selector: string) =>
                selector === "#header-waves use"
                    ? [
                          createMockAnimatedWaveUse(1250, 7000),
                          createMockAnimatedWaveUse(980, 10000),
                      ]
                    : [],
        } as unknown as Document;

        expect(captureBannerWaveAnimationSnapshot(sourceDocument)).toEqual({
            layers: [
                {
                    currentTimeMs: 1250,
                    durationMs: 7000,
                },
                {
                    currentTimeMs: 980,
                    durationMs: 10000,
                },
            ],
        });
    });

    it("primeBannerWaveAnimationSnapshot 会把 incoming 文档首帧波浪相位预写进去", () => {
        const bannerWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const backgroundWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const targetDocument = {
            querySelectorAll: (selector: string) => {
                if (selector === "#header-waves use") {
                    return bannerWaveUses;
                }
                if (selector === ".main-panel-transition-bg-wave use") {
                    return backgroundWaveUses;
                }
                return [];
            },
        } as unknown as Document;

        primeBannerWaveAnimationSnapshot(
            {
                layers: [
                    {
                        currentTimeMs: 1100,
                        durationMs: 7000,
                    },
                    {
                        currentTimeMs: 760,
                        durationMs: 10000,
                    },
                ],
            },
            targetDocument,
        );

        expect(bannerWaveUses[0]?.style.animationDuration).toBe("7000ms");
        expect(bannerWaveUses[0]?.style.animationDelay).toBe("-1100ms");
        expect(bannerWaveUses[1]?.style.animationDuration).toBe("10000ms");
        expect(bannerWaveUses[1]?.style.animationDelay).toBe("-760ms");
        expect(backgroundWaveUses[0]?.style.animationDelay).toBe("-1100ms");
        expect(backgroundWaveUses[1]?.style.animationDelay).toBe("-760ms");
    });

    it("applyBannerWaveAnimationSnapshot 会把 live DOM 的波浪 currentTime 校正到旧页面相位", () => {
        const bannerWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const backgroundWaveUses = [
            createMockAnimatedWaveUse(0),
            createMockAnimatedWaveUse(0),
        ];
        const targetDocument = {
            querySelectorAll: (selector: string) => {
                if (selector === "#header-waves use") {
                    return bannerWaveUses;
                }
                if (selector === ".main-panel-transition-bg-wave use") {
                    return backgroundWaveUses;
                }
                return [];
            },
        } as unknown as Document;

        applyBannerWaveAnimationSnapshot(
            {
                layers: [
                    {
                        currentTimeMs: 1100,
                        durationMs: 7000,
                    },
                    {
                        currentTimeMs: 760,
                        durationMs: 10000,
                    },
                ],
            },
            targetDocument,
        );

        expect(bannerWaveUses[0]?.getAnimations()[0]?.currentTime).toBe(1100);
        expect(bannerWaveUses[1]?.getAnimations()[0]?.currentTime).toBe(760);
        expect(backgroundWaveUses[0]?.getAnimations()[0]?.currentTime).toBe(
            1100,
        );
        expect(backgroundWaveUses[1]?.getAnimations()[0]?.currentTime).toBe(
            760,
        );
    });
});
