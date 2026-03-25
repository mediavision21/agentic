// parse raw LLM response text into structured content for ChatMessage
// mirrors backend agent.py extract_sql / extract_plot_config logic
// resultData: {columns, rows, plot_config, summary} from stored result_data
function parseRawResponse(rawText, resultData) {
    if (!rawText) {
        return { loading: false, text: "", raw_text: "" }
    }

    const sqlMatch = rawText.match(/```sql\s*([\s\S]*?)\s*```/)
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/)

    // SQL path — structured response
    if (sqlMatch) {
        const sql = sqlMatch[1].trim()
        let plot_config = null
        if (jsonMatch) {
            try { plot_config = JSON.parse(jsonMatch[1].trim()) }
            catch (e) { /* ignore parse errors */ }
        }

        // thinking = everything before the first ``` fence
        const firstFence = rawText.indexOf("```")
        const thinking = firstFence > 0 ? rawText.slice(0, firstFence).trim() : ""

        // explanation = text AFTER the last ``` fence
        const lastFenceEnd = rawText.lastIndexOf("```")
        const explanation = lastFenceEnd >= 0 ? rawText.slice(lastFenceEnd + 3).trim() : ""

        const content = {
            loading: false,
            streaming_text: thinking || undefined,
            sql,
            explanation,
            plot_config: (resultData && resultData.plot_config) || plot_config,
            raw_text: rawText,
        }

        if (resultData) {
            if (resultData.columns) content.columns = resultData.columns
            if (resultData.rows) content.rows = resultData.rows
            if (resultData.summary) content.summary = resultData.summary
        }

        return content
    }

    // conversational path — plain text
    let suggestions = []
    const suggMatch = rawText.match(/<!--suggestions\s*([\s\S]*?)\s*-->/)
    if (suggMatch) {
        suggestions = suggMatch[1].split("\n").map(function (l) { return l.trim() }).filter(Boolean)
    }
    const displayText = rawText.replace(/\s*<!--suggestions[\s\S]*?-->/, "").trim()

    return {
        loading: false,
        text: displayText,
        raw_text: rawText,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
    }
}

export default parseRawResponse
