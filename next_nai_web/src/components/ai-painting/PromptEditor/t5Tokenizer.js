// t5Tokenizer.js
// 移植自 t5_token_counter.html 的核心 Tokenizer 逻辑

// --- 核心 Tokenizer 逻辑 ---

// Trie 树
class b {
    constructor() { this.root = m.default() }
    push(e) { let t = this.root; for (let r of e) { let e = t.children.get(r); void 0 === e && (e = m.default(), t.children.set(r, e)), t = e } t.isLeaf = !0 } *
    commonPrefixSearch(e) { let t = this.root, r = ""; for (let s = 0; s < e.length && void 0 !== t; s++) { let n = e[s]; r += n, void 0 !== (t = t.children.get(n)) && t.isLeaf && (yield r) } }
}

// Trie 节点
class m {
    constructor(e, t) { this.isLeaf = e, this.children = t }
    static default() { return new m(!1, new Map) }
}

// Lattice (维特比)
class v {
    constructor(e, t, r) { this.sentence = e, this.len = e.length, this.bosTokenId = t, this.eosTokenId = r, this.nodes = [], this.beginNodes = Array.from({ length: this.len + 1 }), this.endNodes = Array.from({ length: this.len + 1 }); for (let e = 0; e < this.len + 1; e++) this.beginNodes[e] = [], this.endNodes[e] = []; let s = new T(this.bosTokenId, 0, 0, 0, 0), n = new T(this.eosTokenId, 1, this.len, 0, 0); this.nodes.push(s.clone(), n.clone()), this.beginNodes[this.len].push(n), this.endNodes[0].push(s) }
    insert(e, t, r, s) { let n = new T(s, this.nodes.length, e, t, r); this.beginNodes[e].push(n), this.endNodes[e + t].push(n), this.nodes.push(n) }
    viterbi() {
        let e = this.len,
            t = 0;
        for (; t <= e;) {
            if (0 === this.beginNodes[t].length) return [];
            for (let e of this.beginNodes[t]) {
                e.prev = null;
                let r = 0,
                    s = null;
                for (let n of this.endNodes[t]) { let t = n.backtraceScore + e.score; (null === s || t > r) && (s = n.clone(), r = t) }
                if (null === s) return [];
                e.prev = s, e.backtraceScore = r
            }
            t++
        }
        let r = [],
            s = this.beginNodes[e][0].prev;
        if (null === s) return [];
        let n = s.clone();
        for (; null !== n.prev;) r.push(n.clone()), n = n.clone().prev.clone();
        return r.reverse(), r
    }
    piece(e) { return this.sentence.slice(e.pos, e.pos + e.length) }
    tokens() { return this.viterbi().map(e => this.piece(e)) }
    tokenIds() { return this.viterbi().map(e => e.tokenId) }
}

// Lattice 节点
class T {
    constructor(e, t, r, s, n) { this.tokenId = e, this.nodeId = t, this.pos = r, this.length = s, this.score = n, this.prev = null, this.backtraceScore = 0 }
    clone() { let e = new T(this.tokenId, this.nodeId, this.pos, this.length, this.score); return e.prev = this.prev, e.backtraceScore = this.backtraceScore, e }
}

// Token processor 工厂
class y {
    static fromConfig(e) {
        if (!e) {
            // 提供一个默认的空处理器，如果配置中缺少 normalizer, pre_tokenizer 或 decoder
            console.warn("Tokenizer config missing processor definition. Using NoOp processor.");
            return new NoOpProcessor();
        }
        switch (e.type) {
            case "Metaspace":
                return new I(e.add_prefix_space, e.replacement, e.str_rep);
            case "Precompiled":
                return new w(e.precompiled_charsmap);
            case "Sequence":
                return new N(e.pretokenizers.map(e => y.fromConfig(e)));
            case "WhitespaceSplit":
                return new x;
            default:
                 // 如果类型未知，也返回 NoOpProcessor
                 console.warn("Unknown token processor type:", e.type, ". Using NoOp processor.");
                 return new NoOpProcessor();
        }
    }
}

// NoOp (空操作) Processor，用于处理配置缺失的情况
class NoOpProcessor extends y {
    preTokenize(e) { return e; }
    decodeChain(e) { return e; }
    normalize(e) { return e; }
}

// Metaspace processor
class I extends y {
    constructor(e, t, r) { super(), this.addPrefixSpace = e, this.replacement = t, this.strRep = r || this.replacement }
    preTokenize(e) { let t = []; for (let r of e) { let e = r.replace(" ", this.strRep); this.addPrefixSpace && !e.startsWith(this.replacement) && (e = this.strRep + e), t.push(e) } return t }
    decodeChain(e) { let t = [], r = 0; for (let s of e) { let e = s.replace(this.replacement, " "); this.addPrefixSpace && 0 == r && e.startsWith(" "), t.push(e), r++ } return t }
}

// Precompiled processor
class w extends y {
    constructor(e) { super(), this.charsmap = e }
    normalize(e) { return e } 
}

// Sequence processor
class N extends y {
    constructor(e) { super(), this.tokenizers = e }
    preTokenize(e) { let t = e; for (let e of this.tokenizers) t = e.preTokenize(t); return t }
}

// WhitespaceSplit processor
class x extends y {
    preTokenize(e) { let t = []; for (let r of e) t.push(...r.split(/\s+/)); return t }
}

// T5 Tokenizer (SentencePiece)
// (原名 g)
export class T5Tokenizer {
    constructor(e, t, r, s, n, i) { this.vocab = e, this.unkTokenId = t, this.specialTokens = r, this.specialTokenIds = new Map(r.map(e => [e.id, e])), this.normalizer = s, this.preTokenizer = n, this.decoder = i, this.tokenToIds = new Map(e.map((e, t) => [this.normalize(e[0]), t])), this.bosToken = this.normalize(" "), this.bosTokenId = this.getTokenId(this.bosToken), this.eosToken = "</s>", this.eosTokenId = this.getTokenId(this.eosToken), this.unkToken = this.vocab[this.unkTokenId][0], this.trie = new b, this.minScore = 1e6, e.forEach(e => this.minScore = Math.min(this.minScore, e[1])), this.unkScore = this.minScore - 10, e[t][1] = this.unkScore, e.forEach(e => this.trie.push(e[0])) }
    static fromConfig(e) { 
        let t = y.fromConfig(e.pre_tokenizer); 
        let r = y.fromConfig(e.normalizer); 
        let s = y.fromConfig(e.decoder); 
        return new T5Tokenizer(e.model.vocab, e.model.unk_id, e.added_tokens, r, t, s); 
    }
    getTokenId(e) { return this.tokenToIds.get(e) }
    normalize(e) { return this.normalizer.normalize(e) }
    preTokenize(e) { return this.preTokenizer.preTokenize(e) }
    populateNodes(e) {
        let t = e.sentence,
            r = t.length,
            s = 0;
        for (; s < r;) {
            let r = !1,
                n = [];
            for (let i of this.trie.commonPrefixSearch(t.slice(s))) { n.push(i); let t = this.getTokenId(i), o = this.vocab[t][1], l = i.length; e.insert(s, l, o, t), r || 1 != l || (r = !0) }
            r || e.insert(s, 1, this.unkScore, this.unkTokenId), s += 1
        }
    }
    tokenize(e) { let t = new v(e, this.bosTokenId, this.eosTokenId); return this.populateNodes(t), t.tokenIds() }
    encode(e) {
        if (null == e || 0 === e.length) return [this.eosTokenId];
        // 注意：T5 特定的预处理，移除了加权和降权符号。
        e = e.replace(/[[\]{}]/g, "").replace(/-?\d*\.?\d*::/g, "");
        let t = this.normalize(e),
            r = this.preTokenize([t]),
            s = [];
        for (let e of r) { let t = this.tokenize(e); s.push(...t) }
        return s.push(this.eosTokenId), s
    }
    decode(e, t) { let r = e.map(e => void 0 !== this.specialTokenIds.get(e) && t ? "" : e == this.unkTokenId ? this.unkToken + " " : e in this.vocab ? this.vocab[e][0] : `[${e}]`); return this.decoder.decodeChain(r).join("") }
}


// --- Singleton Loader ---
let tokenizerInstance = null;
let tokenizerPromise = null;

/**
 * 异步加载并初始化 T5 Tokenizer (单例模式)
 * @param {string} jsonPath - t5_tokenizer.json 的路径 (例如 './t5_tokenizer.json')
 * @returns {Promise<T5Tokenizer>}
 */
export async function getTokenizer(jsonPath = './t5_tokenizer.json') {
    if (tokenizerInstance) {
        return tokenizerInstance;
    }
    
    if (tokenizerPromise) {
        return tokenizerPromise;
    }

    tokenizerPromise = new Promise(async (resolve, reject) => {
        try {
            // 假设 t5_tokenizer.json 位于 public 文件夹或可访问的根路径
            const response = await fetch(jsonPath); 
            if (!response.ok) {
                const error = new Error('TOKENIZER_LOAD_FAILED');
                error.code = 'TOKENIZER_LOAD_FAILED';
                throw error;
            }
            
            const config = await response.json();
            
            tokenizerInstance = T5Tokenizer.fromConfig(config);
            resolve(tokenizerInstance);
        } catch (err) {
            console.error('初始化 Tokenizer 失败:', err);
            tokenizerPromise = null; // 允许重试
            reject(err);
        }
    });

    return tokenizerPromise;
}
