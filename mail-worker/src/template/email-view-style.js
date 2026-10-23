export default `
    * { box-sizing: border-box; }
    html[data-mail-view], html[data-mail-view] * {
        scrollbar-width: none !important;
    }
    html[data-mail-view]::-webkit-scrollbar,
    html[data-mail-view] *::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
    }
    html {
        background: #fff;
        -webkit-text-size-adjust: 100%;
        text-size-adjust: 100%;
        overflow-wrap: anywhere;
    }
    body {
        margin: 0;
        padding: 16px;
        color: #13181d;
        background: #fff;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 16px;
        line-height: 1.6;
    }
    img { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    [data-mail-table-scroll] {
        width: 100%;
        max-width: 100%;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-x: contain;
    }
    @media (max-width: 600px) {
        html[data-mail-view] {
            --mail-view-inline-limit: 4px;
            --mail-view-white-space: normal;
            --mail-view-min-width: 0px;
            --mail-view-max-width: 100%;
        }
        html[data-mail-view] :is([data-mail-data-table], a, button) {
            --mail-view-inline-limit: initial;
        }
        html[data-mail-view] [data-mail-data-table] {
            --mail-view-white-space: initial;
            --mail-view-min-width: initial;
            --mail-view-max-width: initial;
        }
        html[data-mail-view], html[data-mail-view] body {
            width: auto !important;
            min-width: 0 !important;
            max-width: 100% !important;
            margin: 0 !important;
        }
        html[data-mail-view] body {
            padding: 8px !important;
            padding-top: max(8px, env(safe-area-inset-top)) !important;
            padding-bottom: max(8px, env(safe-area-inset-bottom)) !important;
            padding-left: max(4px, env(safe-area-inset-left)) !important;
            padding-right: max(4px, env(safe-area-inset-right)) !important;
        }
        html[data-mail-view] :is(div, section, article, main, header, footer, center, figure, figcaption, blockquote, p, pre, ul, ol, li, dl, dt, dd, span, a, code, h1, h2, h3, h4, h5, h6) {
            box-sizing: border-box !important;
            width: auto !important;
            min-width: 0 !important;
            max-width: 100% !important;
            flex-wrap: wrap !important;
            grid-template-columns: minmax(0, 1fr) !important;
        }
        html[data-mail-view] table:not([data-mail-data-table]) {
            min-width: 0 !important;
            max-width: 100% !important;
        }
        html[data-mail-view] table[data-mail-fluid-table] {
            width: 100% !important;
            margin-left: 0 !important;
            margin-right: 0 !important;
        }
        html[data-mail-view] table[data-mail-layout-table] {
            table-layout: fixed !important;
        }
        html[data-mail-view] table:not([data-mail-data-table]) > :is(thead, tbody, tfoot) > tr > :is(td, th),
        html[data-mail-view] table:not([data-mail-data-table]) > tr > :is(td, th) {
            min-width: 0 !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
        }
        html[data-mail-view] :is(img, svg, video) {
            --mail-view-media-height: auto;
            --mail-view-media-min-height: 0px;
            min-width: 0 !important;
            max-width: 100% !important;
            height: auto !important;
        }
        html[data-mail-view] :is(p, a, li, pre) {
            overflow-wrap: anywhere !important;
        }
        html[data-mail-view] pre { white-space: pre-wrap !important; }
        html[data-mail-view] :is(h1, h2) {
            font-size: clamp(20px, 5vw, 24px);
            line-height: 1.35;
        }
    }
`;
