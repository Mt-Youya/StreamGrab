(function () {
  var t = localStorage.getItem("sg-theme");
  var d = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme:dark)").matches);
  if (d) document.documentElement.classList.add("dark");
})();
