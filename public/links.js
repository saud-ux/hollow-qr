// Copy buttons for /links (external file: the site CSP blocks inline scripts).
document.querySelectorAll("[data-copy]").forEach(function (btn) {
  btn.addEventListener("click", function () {
    var text = btn.getAttribute("data-copy");
    var done = function () {
      btn.textContent = "تم النسخ";
      btn.classList.add("copied");
      setTimeout(function () { btn.textContent = "نسخ"; btn.classList.remove("copied"); }, 1600);
    };
    var fallback = function () {
      var link = btn.closest(".item").querySelector(".url");
      var range = document.createRange();
      range.selectNodeContents(link);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = "انسخ الرابط المحدد";
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
    } catch (e) { fallback(); }
  });
});
