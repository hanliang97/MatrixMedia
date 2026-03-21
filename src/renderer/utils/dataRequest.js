export default function (data) {
  return new Promise(resFn => {
    fetch("http://localhost:30088/changeData", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(r => r.json())
      .then(r => {
        resFn(r);
      });
  });
}
