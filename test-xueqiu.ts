async function main() {
  const res = await fetch("https://xueqiu.com/S/SZ000988", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const text = await res.text();
  console.log(text.substring(0, 1000));
  console.log("Timeline details:", text.match(/<article[^>]*>[\s\S]*?<\/article>/g)?.length || "0 articles");
}

void main();
