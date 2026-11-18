export function downloadJson(filename, value) {
 const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
 const link = document.createElement('a');
 link.href = url;
 link.download = filename;
 try {
  document.body.append(link);
  link.click();
 } finally {
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
 }
}
