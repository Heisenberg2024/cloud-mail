// Synthetic mail only; shared by DOM regressions and local viewport inspection.
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360"><rect width="1200" height="360" fill="#e8f1ff"/><text x="60" y="205" font-size="70" fill="#1768c5">Responsive image</text></svg>');
const longValue = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(6);
const ending = '<p id="mail-end">邮件正文结束 / End of message</p>';

export default [
	{
		id: 'newsletter', name: '多层卡片与导航',
		html: `<html><head><style>.outer{padding:32px;background:#eee}.copy{padding:28px 40px;line-height:1.8}</style></head><body>
		<div class="outer"><table role="presentation" width="680" cellpadding="16"><tr><td>
		<table role="presentation" width="100%"><tr><td width="35%">示例科技</td><td>首页</td><td>最新活动</td><td>帮助中心</td></tr></table>
		<div class="copy"><h2>服务通知与更新</h2><p>这封邮件包含多层卡片与固定边距，正文应清晰显示，并使用小窗口的可用宽度。</p>
		<p>第二段保留正常字号、段落间距和导航比例。</p>${ending}</div></td></tr></table></div></body></html>`
	},
	{
		id: 'images', name: '大图与内嵌 SVG',
		html: `<h2>图片邮件</h2><p>图片保持比例，正文仍然清晰。</p>
		<figure style="width:960px;min-width:960px;margin:20px 32px"><img id="hero" width="1200" height="360" style="min-width:1200px!important;max-width:none!important;width:1200px;height:360px!important;min-height:360px!important" src="${image}" alt="宽幅图片"><figcaption>宽幅图片说明</figcaption></figure>
		<svg id="drawing" width="900" height="180" style="min-width:900px" viewBox="0 0 900 180"><rect width="900" height="180" fill="#edf8ed"/><text x="40" y="105" font-size="36">Inline SVG</text></svg>${ending}`
	},
	{
		id: 'tables', name: '双列表格与宽数据表',
		html: `<table role="presentation" width="800"><tr><td><h2>账单明细</h2>
		<table id="invoice" width="720" style="min-width:720px;white-space:nowrap" cellpadding="16"><tr><td>项目</td><td>详细信息</td></tr><tr><td>订单编号</td><td>${longValue}</td></tr><tr><td>合计</td><td>100.00</td></tr></table>
		<p>宽表格在自身区域滑动，正文不跟着变宽。</p>
		<table id="report" style="min-width:900px" cellpadding="12"><tr><th>项目</th><th>数量</th><th>金额</th></tr><tr><td>报告项目</td><td>12</td><td>200.00</td></tr></table>${ending}</td></tr></table>`
	},
	{
		id: 'links', name: '长链接与代码',
		html: `<style>.tracking{white-space:nowrap!important}</style><h2>链接与代码</h2>
		<p class="tracking"><a href="https://example.com/${longValue}">https://example.com/${longValue}</a></p>
		<div style="white-space:nowrap"><span>${longValue}</span></div>
		<pre style="width:900px;min-width:900px">${longValue}\n第二行代码</pre>
		${'<p>正文段落保持可读字号，可以继续向下滑动。</p>'.repeat(18)}${ending}`
	},
	{
		id: 'columns', name: '多列与弹性布局',
		html: `<h2>多列图文邮件</h2><div style="display:grid;grid-template-columns:480px 480px;gap:20px">
		<div><img width="800" src="${image}" alt="第一张图片"><p>${longValue}</p></div><div><img width="800" src="${image}" alt="第二张图片"><p>第二列正文应在窄屏下正常阅读。</p></div></div>
		<div style="display:flex;gap:16px"><p style="min-width:500px">弹性布局中的长文字不应撑宽页面。</p><p style="min-width:500px">第二段正文。</p></div>${ending}`
	},
	{
		id: 'plain', name: '纯文本与长网址',
		text: `纯文本邮件\n\nhttps://example.com/${longValue}\n\n<div>按字面显示 & 保留换行</div>\n\n${'正文保持清晰，可继续向下滑动。\n\n'.repeat(30)}邮件正文结束 / End of message`
	}
];
