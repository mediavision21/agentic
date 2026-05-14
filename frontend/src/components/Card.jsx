function Cards(options) {
	const { items } = options
	if (!items || items.length === 0) return null
	return (
		<div className={"mv-cards mv-cards-" + items.length}>
			{items.map(function (card, i) {
				return (
					<div key={i} className="mv-card">
						<div className="mv-card-label">{card.label}</div>
						<div className="mv-card-value">{card.value}</div>
					</div>
				)
			})}
		</div>
	)
}

export default Cards
