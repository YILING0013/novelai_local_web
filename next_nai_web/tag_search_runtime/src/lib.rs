use memchr::memmem::Finder;
use regex::bytes::RegexBuilder;
use std::{cmp::Reverse, collections::BinaryHeap};
use wasm_bindgen::prelude::*;

struct Row {
    start: usize,
    ends: [usize; 5],
    end: usize,
}

#[wasm_bindgen]
pub struct TagCatalog {
    data: Vec<u8>,
    rows: Vec<Row>,
}

#[wasm_bindgen]
impl TagCatalog {
    /// 读取按引用量排列的二进制词条，保留字节偏移以便连续查询时复用。
    /// data 为已解压的词条区域，返回可重复查询的目录；损坏的数据直接报错。
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<u8>) -> Result<TagCatalog, String> {
        let mut rows = Vec::new();
        let mut position = 0;
        while position < data.len() {
            let header = data.get(position..position + 12).ok_or("invalid_catalog")?;
            let length = |i| u16::from_le_bytes([header[i], header[i + 1]]) as usize;
            position += 12;
            let start = position;
            let mut ends = [0; 5];
            for (i, end) in ends.iter_mut().enumerate() {
                position += length(i * 2);
                *end = position;
            }
            position += length(10) * 2;
            if position > data.len() {
                return Err("invalid_catalog".into());
            }
            rows.push(Row {
                start,
                ends,
                end: position,
            });
        }
        Ok(Self { data, rows })
    }

    /// 在指定分类（0 为全库）匹配英文、中文、全拼及首字母。返回按相关度、引用量排序的姓名及译文对。
    /// mode 接受 text、fuzzy、regex；limit 为界面可显示的条数，词库不会为一个短词保留全部命中。
    pub fn search(
        &self,
        query: &str,
        topic: u16,
        mode: &str,
        limit: usize,
    ) -> Result<String, String> {
        if limit == 0 {
            return Ok("[]".into());
        }
        let pattern = if mode == "regex" {
            if query.len() > 1024 {
                return Err("invalid_regex".into());
            }
            Some(
                RegexBuilder::new(query)
                    .case_insensitive(true)
                    .size_limit(2 << 20)
                    .build()
                    .map_err(|_| "invalid_regex")?,
            )
        } else {
            None
        };
        let needle = query.as_bytes();
        let finder = Finder::new(needle);
        let fuzzy = mode == "fuzzy";
        let mut best = BinaryHeap::new();
        for (i, row) in self.rows.iter().enumerate() {
            let [name, translation, normalized, pinyin, initials] = row.ends;
            if topic != 0
                && !self.data[initials..row.end]
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .any(|pair| u16::from_le_bytes(*pair) == topic)
            {
                continue;
            }
            let english = &self.data[row.start..name];
            let chinese = &self.data[translation..normalized];
            let fields = [
                english,
                chinese,
                &self.data[normalized..pinyin],
                &self.data[pinyin..initials],
            ];
            let score = if let Some(re) = &pattern {
                if ![english, &self.data[name..translation], fields[2], fields[3]]
                    .iter()
                    .any(|s| re.is_match(s))
                {
                    continue;
                }
                1000
            } else if needle.is_empty() {
                1000
            } else {
                let mut top = 0;
                for (field, penalty) in fields.into_iter().zip([0, 0, 2, 6]) {
                    if field.is_empty() {
                        continue;
                    }
                    let score: u16 = if field == needle {
                        1000
                    } else if field.starts_with(needle) {
                        950
                    } else if let Some(pos) = finder.find(field) {
                        if b"_ (/-".contains(&field[pos - 1]) {
                            900
                        } else {
                            850
                        }
                    } else if fuzzy {
                        fuzzy_score(needle, field)
                    } else {
                        0
                    };
                    top = top.max(score.saturating_sub(penalty));
                    if top == 1000 {
                        break;
                    }
                }
                if top == 0 {
                    continue;
                }
                top
            };
            // 同分沿用词库的引用量顺序；堆顶始终是当前候选中最差的一条。
            let entry = (Reverse(score), i);
            if best.len() < limit {
                best.push(entry);
            } else if entry < *best.peek().unwrap() {
                *best.peek_mut().unwrap() = entry;
            }
            if (pattern.is_some() || needle.is_empty()) && best.len() == limit {
                break;
            }
        }
        let result: Vec<_> = best
            .into_sorted_vec()
            .into_iter()
            .map(|(_, i)| {
                let row = &self.rows[i];
                [
                    String::from_utf8_lossy(&self.data[row.start..row.ends[0]]),
                    String::from_utf8_lossy(&self.data[row.ends[0]..row.ends[1]]),
                ]
            })
            .collect();
        Ok(serde_json::to_string(&result).expect("strings serialize to JSON"))
    }
}

// 模糊分数优先紧密有序的字符；英文单词另外容许一次增、删、改输入错误。
// 非 ASCII 只比较完整 Unicode 字符，避免把不同汉字共有的 UTF-8 字节当作相似。
fn fuzzy_score(needle: &[u8], field: &[u8]) -> u16 {
    if needle.len() < 2 {
        return 0;
    }
    if !needle.is_ascii() {
        let Ok(query) = std::str::from_utf8(needle) else {
            return 0;
        };
        let Ok(value) = std::str::from_utf8(field) else {
            return 0;
        };
        return subsequence(query.chars(), value.chars());
    }
    let mut score = subsequence(needle.iter().copied(), field.iter().copied());
    if needle.len() >= 3 {
        for word in field.split(|b| b"_ ()/-".contains(b)) {
            if word.len().abs_diff(needle.len()) > 1 {
                continue;
            }
            let common = word.iter().zip(needle).take_while(|(a, b)| a == b).count();
            let (a, b) = (&word[common..], &needle[common..]);
            let near = match a.len().cmp(&b.len()) {
                std::cmp::Ordering::Less => a == &b[1..],
                std::cmp::Ordering::Greater => &a[1..] == b,
                std::cmp::Ordering::Equal => {
                    a.is_empty()
                        || a[1..] == b[1..]
                        || (a.len() >= 2 && a[0] == b[1] && a[1] == b[0] && a[2..] == b[2..])
                }
            };
            if near {
                score = score.max(780);
                break;
            }
        }
    }
    score
}

fn subsequence<T: Eq>(mut query: impl Iterator<Item = T>, field: impl Iterator<Item = T>) -> u16 {
    let Some(mut wanted) = query.next() else {
        return 0;
    };
    let mut first = 0;
    let mut matched = 0;
    for (index, c) in field.enumerate() {
        if c != wanted {
            continue;
        }
        if matched == 0 {
            first = index;
        }
        matched += 1;
        match query.next() {
            Some(next) => wanted = next,
            None => {
                let density = 100 * matched / (index - first + 1);
                return if density >= 55 {
                    200 + density as u16 * 5 + u16::from(first == 0) * 25
                } else {
                    0
                };
            }
        }
    }
    0
}
