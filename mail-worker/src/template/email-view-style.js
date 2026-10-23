export default `
    * { box-sizing: border-box; }
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
        html[data-mail-view], html[data-mail-view] body {
            width: auto !important;
            min-width: 0 !important;
            max-width: 100% !important;
            margin: 0 !important;
        }
        html[data-mail-view] body {
            padding: 12px !important;
            padding-top: max(12px, env(safe-area-inset-top)) !important;
            padding-bottom: max(12px, env(safe-area-inset-bottom)) !important;
            padding-left: max(12px, env(safe-area-inset-left)) !important;
            padding-right: max(12px, env(safe-area-inset-right)) !important;
        }
        html[data-mail-view] :is(div, section, article, main, header, footer, center) {
            min-width: 0 !important;
            max-width: 100% !important;
        }
        html[data-mail-view] table:not([data-mail-data-table]) {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            table-layout: fixed !important;
        }
        html[data-mail-view] table:not([data-mail-data-table]) > :is(thead, tbody, tfoot) > tr > :is(td, th),
        html[data-mail-view] table:not([data-mail-data-table]) > tr > :is(td, th) {
            width: auto !important;
            min-width: 0 !important;
            white-space: normal !important;
            overflow-wrap: anywhere !important;
        }
        html[data-mail-view] :is(img, svg, video) {
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
