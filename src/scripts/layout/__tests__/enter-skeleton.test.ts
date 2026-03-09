import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prepareEnterSkeletonForIncomingDocument } from "../enter-skeleton";

const createClassList = () => {
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
};

describe("enter-skeleton", () => {
    beforeEach(() => {
        class MockHtmlElement {}
        vi.stubGlobal("HTMLElement", MockHtmlElement);
        vi.stubGlobal("window", {
            clearTimeout,
            setTimeout,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("prepareEnterSkeletonForIncomingDocument 会只给 incoming 文档打骨架状态", () => {
        const documentElement = Object.assign(new HTMLElement(), {
            classList: createClassList(),
            setAttribute: vi.fn(),
        });
        const targetDocument = {
            documentElement,
            querySelector: (selector: string) =>
                selector === '[data-enter-skeleton-target="post-detail"]'
                    ? {}
                    : null,
        } as unknown as Document;

        prepareEnterSkeletonForIncomingDocument(targetDocument);

        expect(
            documentElement.classList.contains("enter-skeleton-active"),
        ).toBe(true);
        expect(documentElement.setAttribute).toHaveBeenCalledWith(
            "data-enter-skeleton-mode",
            "post-detail",
        );
    });
});
