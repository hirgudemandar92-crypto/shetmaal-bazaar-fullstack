document.addEventListener('submit', function (e) {
  const form = e.target;
  if (form.dataset.confirm) {
    const ok = confirm(form.dataset.confirm);
    if (!ok) e.preventDefault();
  }
});

document.querySelectorAll('input[data-live-capture="true"]').forEach((input) => {
  input.addEventListener('change', function () {
    const file = this.files && this.files[0];
    if (!file) return;

    const isImageField = this.name === 'image';
    const validType = isImageField ? file.type.startsWith('image/') : file.type.startsWith('video/');

    if (!validType) {
      alert('फक्त योग्य फोटो किंवा व्हिडिओ फाइल निवडा.');
      this.value = '';
      return;
    }
  });
});
